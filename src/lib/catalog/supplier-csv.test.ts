import { describe, expect, it } from "vitest";

import { parseSupplierCsv } from "./supplier-csv";

describe("CSV de disponibilidad del proveedor", () => {
  it("lee columnas en español, montos y disponibilidad", () => {
    const r = parseSupplierCsv(
      "sku,disponibilidad,cantidad,sku_proveedor,costo\n" +
        "PRO-1,Disponible,12,DN-1,450.00\n" +
        "PRO-2,no disponible,,DN-2,\n" +
        'PRO-3,limitado,2,,"1,250.50"\n',
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          row: 2,
          sku: "PRO-1",
          availability: "available",
          quantity: 12,
          supplier_sku: "DN-1",
          unit_cost: 45000,
        },
        {
          row: 3,
          sku: "PRO-2",
          availability: "unavailable",
          supplier_sku: "DN-2",
          unit_cost: null,
        },
        {
          row: 4,
          sku: "PRO-3",
          availability: "limited",
          quantity: 2,
          supplier_sku: null,
          unit_cost: 125050,
        },
      ],
    });
  });

  it("columnas ausentes no se envían (se conserva lo guardado); cantidad sola = disponible", () => {
    const r = parseSupplierCsv("sku;cantidad\nPRO-1;5\nPRO-2;0\n");
    expect(r).toEqual({
      ok: true,
      rows: [
        { row: 2, sku: "PRO-1", availability: "available", quantity: 5 },
        { row: 3, sku: "PRO-2", availability: "available", quantity: 0 },
      ],
    });
  });

  it("reporta cada fila con su problema", () => {
    const r = parseSupplierCsv(
      "sku,availability,quantity,supplier_cost\n" +
        ",available,1,\n" +
        "A,available,,\n" +
        "B,maybe,1,\n" +
        "C,available,1.5,\n" +
        "D,unknown,,abc\n" +
        "a,unknown,,\n",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        { row: 2, field: "sku" },
        { row: 3, field: "quantity" },
        { row: 4, field: "availability" },
        { row: 5, field: "quantity" },
        { row: 6, field: "unit_cost" },
        { row: 7, field: "duplicate" },
      ]);
    }
  });

  it("una fila sin disponibilidad ni cantidad es un error (no deja en 0 las existencias)", () => {
    expect(parseSupplierCsv("sku,disponibilidad,cantidad\nPRO-1,,\n")).toEqual({
      ok: false,
      errors: [{ row: 2, field: "availability" }],
    });
  });

  it("exige sku y alguna de disponibilidad o cantidad", () => {
    expect(parseSupplierCsv("codigo,cantidad\nX,1\n")).toMatchObject({
      ok: false,
      message: "Falta la columna «sku».",
    });
    expect(parseSupplierCsv("sku,costo\nX,1\n")).toMatchObject({ ok: false });
    expect(parseSupplierCsv("sku,cantidad\n")).toMatchObject({
      message: "El archivo no tiene filas.",
    });
  });
});
