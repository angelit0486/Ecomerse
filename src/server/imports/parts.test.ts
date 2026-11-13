import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { partBody, prepareImport } from "@/lib/imports/split";

import { partRejection, readPartBody } from "./parts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("readPartBody (ADR-064: una parte del lote)", () => {
  it("una parte que preparó el navegador se planea como un archivo más, con su fila original", () => {
    const lines = ["Producto,Precio,Existencias"];
    for (let i = 1; i <= 5003; i += 1) lines.push(`Vaso ${i},${i === 5002 ? "gratis" : "99"},3`);
    const prepared = prepareImport(lines.join("\n"));
    if (!prepared.ok) throw new Error("prepare");
    const body = partBody(prepared.parts[1]!);
    const read = readPartBody(bytes(body));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.fingerprint).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    expect(read.rows.map((r) => r.row_number)).toEqual([5002, 5003, 5004]);
    // El error se señala con la fila del archivo completo, no con la de la parte.
    const bad = read.rows.find((r) => r.row_number === 5003)!;
    expect(bad.errors.join(" ")).toMatch(/^price/);
  });

  it("rechaza lo que no armó el navegador: formato, otro formato de tienda, filas de más", () => {
    expect(readPartBody(bytes("no es json"))).toEqual({ ok: false, code: "formato" });
    const part = { headers: ["handle", "title"], rows: [["a", "A"]], rowNumbers: [2], ignored: [] };
    expect(readPartBody(bytes(JSON.stringify({ v: 2, ...part })))).toEqual({
      ok: false,
      code: "formato",
    });
    // Números de fila repetidos o desordenados.
    expect(
      readPartBody(
        bytes(
          partBody({
            ...part,
            rows: [
              ["a", "A"],
              ["b", "B"],
            ],
            rowNumbers: [3, 3],
          }),
        ),
      ),
    ).toEqual({ ok: false, code: "formato" });
    // Encabezados de Shopify: el navegador debía traducirlos antes.
    expect(
      readPartBody(bytes(partBody({ ...part, headers: ["Handle", "Title", "Variant Price"] }))),
    ).toEqual({ ok: false, code: "columnas" });
    expect(readPartBody(bytes(partBody({ ...part, headers: ["title", "price"] })))).toEqual({
      ok: false,
      code: "columnas",
      detail: "handle",
    });
    const many = Array.from({ length: 5001 }, (_, i) => [`p-${i}`, "P"]);
    expect(
      readPartBody(bytes(partBody({ ...part, rows: many, rowNumbers: many.map((_, i) => i + 2) }))),
    ).toEqual({ ok: false, code: "filas" });
  });

  it("explica cada rechazo de la base sin texto interno", () => {
    expect(partRejection("conflict", "part_applied", undefined)).toMatch(/ya se aplicó/);
    expect(partRejection("validation_failed", "split_product", "taza-azul")).toMatch(
      /«taza-azul» ya está en otra parte/,
    );
    expect(partRejection("rate_limited", "imports", undefined)).toMatch(/30 importaciones/);
    expect(partRejection("internal", undefined, undefined)).toMatch(/Vuelve a intentarlo/);
  });
});
