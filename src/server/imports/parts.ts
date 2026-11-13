import { createHash } from "node:crypto";

import { z } from "zod";

import { detectPlatform } from "@/lib/imports/platforms";
import { MAX_PART_BYTES, MAX_PART_ROWS } from "@/lib/imports/split";

import { checkHeaders, planProductImport, type PlannedRow } from "./products";

/**
 * Una parte de un lote (ADR-064 A), tal como la manda el navegador: filas ya en
 * el formato de la tienda, con su número de fila del archivo original. El
 * servidor la trata como un archivo más: mismos encabezados, mismo plan, mismos
 * validadores. La huella es el SHA-256 de los bytes recibidos (no del JSON
 * reinterpretado): la misma parte da siempre la misma huella.
 */
const partSchema = z
  .object({
    v: z.literal(1),
    headers: z.array(z.string().max(200)).min(1).max(100),
    rows: z
      .array(z.array(z.string().max(20_000)).max(100))
      .min(1)
      .max(MAX_PART_ROWS),
    rowNumbers: z.array(z.number().int().min(2).max(10_000_000)).max(MAX_PART_ROWS),
    ignored: z.array(z.string().max(100)).max(50),
  })
  .strict();

export type PartFailure = "formato" | "columnas" | "filas";

export type ReadPart =
  | {
      ok: true;
      fingerprint: string;
      columns: string[];
      ignored: string[];
      rows: PlannedRow[];
    }
  | { ok: false; code: PartFailure; detail?: string };

export function readPartBody(bytes: Uint8Array): ReadPart {
  if (bytes.length === 0 || bytes.length > MAX_PART_BYTES) return { ok: false, code: "formato" };
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: "formato" };
  }
  const parsed = partSchema.safeParse(json);
  if (!parsed.success) {
    const rows = (json as { rows?: unknown } | null)?.rows;
    return {
      ok: false,
      code: Array.isArray(rows) && rows.length > MAX_PART_ROWS ? "filas" : "formato",
    };
  }
  const { headers, rows, rowNumbers, ignored } = parsed.data;
  // Una fila por número, en el orden del archivo (así la primera de cada producto es la misma).
  if (
    rowNumbers.length !== rows.length ||
    rowNumbers.some((n, i) => i > 0 && n <= rowNumbers[i - 1]!)
  ) {
    return { ok: false, code: "formato" };
  }
  // El navegador ya la pasó al formato de la tienda: otra forma no se acepta.
  if (detectPlatform(headers) !== "pruva") return { ok: false, code: "columnas" };
  const check = checkHeaders(headers);
  if (!check.ok) {
    return {
      ok: false,
      code: "columnas",
      detail: [...check.missing, ...check.duplicated].join(","),
    };
  }
  return {
    ok: true,
    fingerprint,
    columns: check.columns,
    // La base guarda hasta 50 columnas ignoradas, solo para informar.
    ignored: [...new Set([...ignored, ...check.ignored])].slice(0, 50).map((h) => h.slice(0, 100)),
    rows: planProductImport(headers, rows, rowNumbers),
  };
}

/** Mensaje para quien importa, según el motivo con que la base rechazó la parte. */
export function partRejection(
  code: string,
  detail: string | undefined,
  hint: string | undefined,
): string {
  if (code === "rate_limited") {
    return "Llegaste al tope de 30 importaciones por hora. Espera unos minutos y vuelve a elegir el archivo: lo que ya se subió no se repite.";
  }
  if (detail === "part_applied") {
    return "Esa parte ya se aplicó a tu catálogo y no se puede volver a subir. Para cambiar esos productos, importa un archivo nuevo en modo «actualizar».";
  }
  if (detail === "part_processing") {
    return "Esa parte se está aplicando en este momento. Espera a que termine.";
  }
  if (detail === "batch_closed") return "Este lote ya terminó o se canceló. Empieza uno nuevo.";
  if (detail === "split_product") {
    return `El producto «${(hint ?? "").slice(0, 120)}» ya está en otra parte del lote. Las filas de un producto deben ir en la misma parte: si moviste filas en tu archivo, empieza un lote nuevo.`;
  }
  if (detail === "part_fingerprint") {
    return "Esta parte no coincide con el archivo con que empezaste el lote. Elige el mismo archivo.";
  }
  if (detail === "too_many_rows") return "Una parte no puede tener más de 5,000 filas.";
  if (code === "not_found") return "No encontramos ese lote en esta tienda.";
  if (code === "forbidden") return "Tu rol no permite importar productos.";
  return "No pudimos guardar la parte. Vuelve a intentarlo: lo que ya se subió no se repite.";
}
