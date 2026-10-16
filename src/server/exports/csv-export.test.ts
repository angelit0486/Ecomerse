import { describe, expect, it } from "vitest";

import { exportCsv } from "./csv-export";

const row = {
  handle: "a",
  title: "A",
  sku: "A-1",
  price: 10000,
  cost: 4550,
  requires_shipping: true,
};

describe("exportCsv · costo (Fase B)", () => {
  it("con permiso, agrega la columna cost con el formato del precio", () => {
    const [header, line] = exportCsv("products", [row], false, { costs: true })
      .trim()
      .split(/\r?\n/);
    const cols = header!.split(",");
    expect(cols).toContain("cost");
    expect(line!.split(",")[cols.indexOf("cost")]).toBe("45.50");
  });
  it("sin permiso, la columna no existe", () => {
    const [header] = exportCsv("products", [row], false).split(/\r?\n/);
    expect(header!.split(",")).not.toContain("cost");
  });
});
