import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeCsvBytes,
  handleKey,
  MAX_PART_BYTES,
  MAX_PART_ROWS,
  partBody,
  partsToSend,
  prepareImport,
  sha256Hex,
  splitIntoParts,
} from "./split";

const HEADERS = ["handle", "title", "price", "sku"];
const row = (handle: string, n: number, extra = ""): string[] => [
  handle,
  `Producto ${handle}${extra}`,
  "100",
  `SKU-${n}`,
];

/** n productos de una fila cada uno; números de fila desde la 2, como en la hoja. */
function singles(n: number) {
  const rows = Array.from({ length: n }, (_, i) => row(`p-${i + 1}`, i + 1));
  return { rows, rowNumbers: rows.map((_, i) => i + 2) };
}

describe("handleKey (agrupa como el importador)", () => {
  it("ignora espacios, mayúsculas y el apóstrofo anti-fórmulas", () => {
    expect(handleKey("  Taza-Azul ")).toBe("taza-azul");
    expect(handleKey("'-taza")).toBe("-taza");
    expect(handleKey(undefined)).toBe("");
  });
});

describe("splitIntoParts", () => {
  it("12,000 filas → 5,000 + 5,000 + 2,000, en orden y sin perder ni repetir filas", () => {
    const { rows, rowNumbers } = singles(12_000);
    const result = splitIntoParts(HEADERS, rows, rowNumbers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.map((p) => p.rows.length)).toEqual([5000, 5000, 2000]);
    const all = result.parts.flatMap((p) => p.rowNumbers);
    expect(all).toEqual(rowNumbers);
    expect(result.parts[1]!.rows[0]).toEqual(rows[5000]);
  });

  it("nunca separa las filas de un producto: el que cruza el límite pasa completo a la siguiente parte", () => {
    const { rows, rowNumbers } = singles(4998);
    // Filas 4999, 5000 y 5001 del archivo: tres presentaciones del mismo producto.
    for (let v = 0; v < 3; v += 1) {
      rows.push(row("sudadera", 9000 + v));
      rowNumbers.push(rows.length + 1);
    }
    rows.push(row("gorra", 9999));
    rowNumbers.push(rows.length + 1);
    const result = splitIntoParts(HEADERS, rows, rowNumbers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.map((p) => p.rows.length)).toEqual([4998, 4]);
    expect(result.parts[1]!.rows.map((r) => r[0])).toEqual([
      "sudadera",
      "sudadera",
      "sudadera",
      "gorra",
    ]);
    for (const part of result.parts) {
      const handles = new Set(part.rows.map((r) => handleKey(r[0])));
      const others = result.parts.filter((p) => p !== part).flatMap((p) => p.rows);
      expect(others.some((r) => handles.has(handleKey(r[0])))).toBe(false);
    }
  });

  it("filas de un producto separadas en el archivo viajan juntas, en el orden del archivo", () => {
    const { rows, rowNumbers } = singles(6000);
    rows[5999] = row("p-1", 7777); // otra presentación de p-1, al final del archivo
    const result = splitIntoParts(HEADERS, rows, rowNumbers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.parts[0]!;
    const p1 = first.rows.flatMap((r, i) => (r[0] === "p-1" ? [first.rowNumbers[i]] : []));
    expect(p1).toEqual([2, 6001]);
    // Dentro de la parte, siempre el orden del archivo.
    expect([...first.rowNumbers].sort((a, b) => a - b)).toEqual(first.rowNumbers);
  });

  it("parte también por tamaño: ningún cuerpo pasa de 3.5 MB", () => {
    const long = "x".repeat(1500);
    const rows = Array.from({ length: 6000 }, (_, i) => row(`d-${i}`, i, long));
    const rowNumbers = rows.map((_, i) => i + 2);
    const result = splitIntoParts(HEADERS, rows, rowNumbers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.length).toBeGreaterThan(2);
    for (const part of result.parts) {
      expect(part.rows.length).toBeLessThanOrEqual(MAX_PART_ROWS);
      expect(new TextEncoder().encode(partBody(part)).length).toBeLessThanOrEqual(MAX_PART_BYTES);
    }
  });

  it("un producto que no cabe en una parte, o más de 10 partes, se rechaza con el motivo", () => {
    const rows = [row("a", 1), row("b", 2), row("b", 3), row("b", 4)];
    const rowNumbers = [2, 3, 4, 5];
    expect(
      splitIntoParts(HEADERS, rows, rowNumbers, [], { rows: 2, bytes: 1e6, parts: 10 }),
    ).toEqual({ ok: false, code: "producto", detail: "3" });
    const many = singles(12);
    expect(
      splitIntoParts(HEADERS, many.rows, many.rowNumbers, [], { rows: 1, bytes: 1e6, parts: 10 }),
    ).toEqual({ ok: false, code: "partes", detail: "12" });
  });

  it("es determinista: el mismo archivo da las mismas partes y las mismas huellas", async () => {
    const { rows, rowNumbers } = singles(7000);
    const a = splitIntoParts(HEADERS, rows, rowNumbers);
    const b = splitIntoParts(
      HEADERS,
      rows.map((r) => [...r]),
      [...rowNumbers],
    );
    if (!a.ok || !b.ok) throw new Error("split");
    expect(a.parts.map(partBody)).toEqual(b.parts.map(partBody));
    expect(await sha256Hex(partBody(a.parts[0]!))).toBe(await sha256Hex(partBody(b.parts[0]!)));
  });
});

describe("prepareImport", () => {
  it("una hoja en español de 6,000 filas se traduce y se parte en 2 partes", () => {
    const lines = ["Producto,Precio,Existencias,Publicado"];
    for (let i = 1; i <= 6000; i += 1) lines.push(`Taza ${i},$150.00,${i % 7},sí`);
    const prepared = prepareImport(`\uFEFF${lines.join("\r\n")}\r\n`);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.platform).toBe("hoja");
    expect(prepared.rows).toBe(6000);
    expect(prepared.parts.map((p) => p.rows.length)).toEqual([5000, 1000]);
    const part = prepared.parts[1]!;
    expect(part.headers[0]).toBe("handle");
    expect(part.rowNumbers[0]).toBe(5002);
    expect(part.rows[0]![0]).toBe("taza-5001");
    expect(part.headers).toContain("status");
  });

  it("explica lo que no puede leer", () => {
    expect(prepareImport('Producto,Precio\n"Taza,10\n')).toMatchObject({
      ok: false,
      code: "formato",
    });
    expect(prepareImport("Producto,Precio\n")).toEqual({ ok: false, code: "vacio" });
    expect(prepareImport("nombre,costo\nx,1\n")).toEqual({
      ok: false,
      code: "columnas",
      detail: "handle",
    });
  });
});

describe("decodeCsvBytes y sha256Hex", () => {
  it("lee UTF-8 y, si no lo es, Windows-1252; un binario no pasa", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("Año,Precio"))).toBe("Año,Precio");
    expect(decodeCsvBytes(new Uint8Array([0x41, 0xf1, 0x6f]))).toBe("Año");
    expect(decodeCsvBytes(new Uint8Array([0x00, 0xff, 0xfe, 0x00]))).toBeNull();
  });

  it("la huella es el SHA-256 del cuerpo exacto que se sube", async () => {
    const body = partBody({ headers: ["handle"], rows: [["ñandú"]], rowNumbers: [2], ignored: [] });
    expect(await sha256Hex(body)).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
  });
});

describe("partsToSend (retomar o corregir un lote)", () => {
  const fp = ["a", "b", "c", "d"];
  const part = (n: number, status: string, fingerprint: string, errors = 0) => ({
    part: n,
    status,
    fingerprint,
    errors,
  });

  it("sube solo lo que falta: retomar no repite las partes ya subidas", () => {
    expect(partsToSend(fp, [])).toEqual({ ok: true, parts: [1, 2, 3, 4] });
    expect(partsToSend(fp, [part(1, "validated", "a"), part(2, "validated", "b")])).toEqual({
      ok: true,
      parts: [3, 4],
    });
  });

  it("corregir: sube la parte que cambió o la que falló, y nada más", () => {
    const live = [
      part(1, "completed", "a"),
      part(2, "completed", "b"),
      part(3, "failed", "c"),
      part(4, "validated", "d"),
    ];
    expect(partsToSend(fp, live)).toEqual({ ok: true, parts: [3] });
    expect(partsToSend(["a", "b", "c2", "d"], live)).toEqual({ ok: true, parts: [3] });
    expect(
      partsToSend(
        ["a", "b", "c2", "d"],
        [...live.slice(0, 2), part(3, "validated", "c", 4), live[3]!],
      ),
    ).toEqual({ ok: true, parts: [3] });
  });

  it("una parte aplicada o aplicándose no se toca aunque el archivo cambie", () => {
    const live = [part(1, "completed", "a"), part(2, "committing", "b")];
    expect(partsToSend(["a2", "b", "c", "d"], live)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^La parte 1 ya se aplicó/),
    });
    expect(partsToSend(["a", "b2", "c", "d"], live)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^La parte 2 se está aplicando/),
    });
  });
});
