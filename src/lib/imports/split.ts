/**
 * ADR-064, opción A: importar más de 5,000 filas por partes. El navegador lee el
 * archivo, lo pasa al formato de la tienda (lo mismo que haría el servidor con un
 * archivo chico) y lo parte en partes de hasta 5,000 filas sin separar nunca las
 * filas de un mismo producto. Cada parte viaja sola (≤ 3.5 MB) y el servidor la
 * valida como cualquier archivo: el navegador no decide nada sobre el catálogo.
 *
 * Puro y determinista: el mismo archivo da siempre las mismas partes y las
 * mismas huellas, para retomar un lote sin volver a subir lo que ya se subió.
 */
import { CsvParseError, parseCsv } from "@/lib/csv-parse";
import { translatePlatformCsv, type SourcePlatform } from "@/lib/imports/platforms";

/** Filas por parte: el mismo tope de una importación sola. */
export const MAX_PART_ROWS = 5000;
export const MAX_BATCH_PARTS = 10;
export const MAX_BATCH_ROWS = 50_000;
/** Cuerpo de una parte: por debajo de los 4.5 MB que acepta una función de Vercel. */
export const MAX_PART_BYTES = 3_500_000;
/** Archivo que el navegador acepta partir (el servidor nunca lo recibe entero). */
export const MAX_BATCH_FILE_BYTES = 40 * 1024 * 1024;
/** Por debajo de esto (y de 5,000 filas) el archivo sube entero, como siempre. */
export const MAX_SINGLE_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Nombre corto con que el importador agrupa las filas de un producto: sin
 * espacios, en minúsculas y sin el apóstrofo con que la exportación neutraliza
 * fórmulas. El servidor agrupa con esta misma función (products.ts).
 */
export function handleKey(value: string | undefined): string {
  const t = (value ?? "").trim();
  return (/^'[=+\-@]/.test(t) ? t.slice(1) : t).toLowerCase();
}

/** Lo que viaja de cada parte (ya en el formato de la tienda). */
export interface PartContent {
  headers: string[];
  rows: string[][];
  /** Fila de cada una en el archivo original: los errores se señalan con ella. */
  rowNumbers: number[];
  /** Columnas del archivo que no tienen equivalente (solo para avisar). */
  ignored: string[];
}

/** El cuerpo exacto que se sube; su SHA-256 es la huella de la parte. */
export function partBody(part: PartContent): string {
  return JSON.stringify({
    v: 1,
    headers: part.headers,
    rows: part.rows,
    rowNumbers: part.rowNumbers,
    ignored: part.ignored,
  });
}

/** SHA-256 en hexadecimal (Web Crypto: navegador y Node 24). */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bytes del archivo → texto, igual que la ruta de subida: UTF-8 y, si no lo es,
 * Windows-1252 (el «CSV» de Excel en México). Un archivo binario devuelve null.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const text = new TextDecoder("windows-1252").decode(bytes);
    return text.includes("\u0000") ? null : text;
  }
}

export type SplitFailure =
  /** Un producto (todas sus filas) no cabe en una parte. */
  | { ok: false; code: "producto"; detail: string }
  /** El archivo necesita más de 10 partes. */
  | { ok: false; code: "partes"; detail: string };

export interface SplitLimits {
  rows: number;
  bytes: number;
  parts: number;
}

const DEFAULT_LIMITS: SplitLimits = {
  rows: MAX_PART_ROWS,
  bytes: MAX_PART_BYTES,
  parts: MAX_BATCH_PARTS,
};

/**
 * Parte las filas (ya en el formato de la tienda) en partes de hasta 5,000 filas
 * y 3.5 MB. Las filas de un producto (mismo nombre corto) van siempre juntas, en
 * la parte donde aparece su primera fila; dentro de cada parte se conserva el
 * orden del archivo, así la primera fila de cada producto sigue siendo la misma.
 */
export function splitIntoParts(
  headers: string[],
  rows: string[][],
  rowNumbers: number[],
  ignored: string[] = [],
  limits: SplitLimits = DEFAULT_LIMITS,
): { ok: true; parts: PartContent[] } | SplitFailure {
  const at = headers.indexOf("handle");
  const groups = new Map<string, number[]>();
  const order: string[] = [];
  rows.forEach((row, i) => {
    const handle = at < 0 ? "" : handleKey(row[at]);
    // Sin nombre corto, la fila va sola (el servidor la marcará con error).
    const key = handle ? `h:${handle}` : `r:${i}`;
    const group = groups.get(key);
    if (group) group.push(i);
    else {
      groups.set(key, [i]);
      order.push(key);
    }
  });

  const encoder = new TextEncoder();
  // Cada fila suma su JSON, su número de fila y dos comas al cuerpo de la parte.
  const rowBytes = (i: number) =>
    encoder.encode(JSON.stringify(rows[i])).length + String(rowNumbers[i]).length + 2;
  const base = encoder.encode(partBody({ headers, rows: [], rowNumbers: [], ignored })).length;

  const parts: number[][] = [];
  let current: number[] = [];
  let currentBytes = base;
  for (const key of order) {
    const group = groups.get(key)!;
    const bytes = group.reduce((sum, i) => sum + rowBytes(i), 0);
    if (group.length > limits.rows || base + bytes > limits.bytes) {
      return { ok: false, code: "producto", detail: String(rowNumbers[group[0]!]) };
    }
    if (current.length + group.length > limits.rows || currentBytes + bytes > limits.bytes) {
      parts.push(current);
      current = [];
      currentBytes = base;
    }
    current.push(...group);
    currentBytes += bytes;
  }
  if (current.length > 0) parts.push(current);
  if (parts.length > limits.parts) {
    return { ok: false, code: "partes", detail: String(parts.length) };
  }
  return {
    ok: true,
    parts: parts.map((indexes) => {
      const sorted = [...indexes].sort((a, b) => a - b);
      return {
        headers: [...headers],
        rows: sorted.map((i) => rows[i]!),
        rowNumbers: sorted.map((i) => rowNumbers[i]!),
        ignored: [...ignored],
      };
    }),
  };
}

export type PreparedImport =
  | {
      ok: true;
      platform: SourcePlatform;
      rows: number;
      parts: PartContent[];
      productsWithImageUrl: number;
    }
  | SplitFailure
  | { ok: false; code: "formato"; detail: string }
  | { ok: false; code: "vacio" | "columnas" | "filas"; detail?: string };

/**
 * Texto del archivo → partes listas para subir. Mismo lector CSV y misma
 * traducción (Shopify, Tiendanube, hoja en español) que la subida de siempre.
 */
export function prepareImport(text: string): PreparedImport {
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvParseError) {
      return { ok: false, code: "formato", detail: `${error.line}:${error.code}` };
    }
    throw error;
  }
  const source = translatePlatformCsv(parsed.headers, parsed.rows, parsed.rowNumbers);
  if (source.rows.length === 0) return { ok: false, code: "vacio" };
  if (!source.headers.includes("handle")) return { ok: false, code: "columnas", detail: "handle" };
  if (source.rows.length > MAX_BATCH_ROWS) return { ok: false, code: "filas" };
  const ignored = source.ignored.slice(0, 50).map((h) => h.slice(0, 100));
  const split = splitIntoParts(source.headers, source.rows, source.rowNumbers, ignored);
  if (!split.ok) return split;
  return {
    ok: true,
    platform: source.platform,
    rows: source.rows.length,
    parts: split.parts,
    productsWithImageUrl: source.productsWithImageUrl,
  };
}

/** Lo que la base dice que ya se subió de cada parte de un lote. */
export interface UploadedPart {
  part: number;
  status: string;
  fingerprint: string | null;
  errors: number;
}

/**
 * Partes que hay que subir al retomar o corregir un lote: las que faltan, las
 * que fallaron al aplicarse y las que cambiaron. Una parte ya aplicada no se
 * vuelve a subir; si en el archivo cambió, se avisa en lugar de subir nada.
 */
export function partsToSend(
  fingerprints: string[],
  live: UploadedPart[],
): { ok: true; parts: number[] } | { ok: false; message: string } {
  const byPart = new Map(live.map((p) => [p.part, p]));
  const send: number[] = [];
  for (const [i, fingerprint] of fingerprints.entries()) {
    const n = i + 1;
    const current = byPart.get(n);
    if (!current || current.status === "failed") {
      send.push(n);
      continue;
    }
    if (current.fingerprint === fingerprint) continue;
    if (current.status === "completed") {
      return {
        ok: false,
        message: `La parte ${n} ya se aplicó a tu catálogo y en este archivo cambió. Deja sus filas como estaban y corrige solo las partes pendientes; para cambiar productos ya importados, importa otro archivo en modo «actualizar».`,
      };
    }
    if (current.status === "committing") {
      return { ok: false, message: `La parte ${n} se está aplicando. Espera a que termine.` };
    }
    send.push(n);
  }
  return { ok: true, parts: send };
}
