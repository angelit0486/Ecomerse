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

describe("exportCsv · contenido y porciones por presentación (ADR-026)", () => {
  const variant = { ...row, net_content: "2 kg", servings_per_container: 66 };
  it("con la ficha sanitaria, agrega variant_net_content y variant_servings", () => {
    const [header, line] = exportCsv("products", [variant], false, { regulated: true })
      .trim()
      .split(/\r?\n/);
    const cols = header!.split(",");
    const cells = line!.split(",");
    expect(cells[cols.indexOf("variant_net_content")]).toBe("2 kg");
    expect(cells[cols.indexOf("variant_servings")]).toBe("66");
  });
  it("sin productos regulados, las columnas no existen", () => {
    const [header] = exportCsv("products", [variant], false).split(/\r?\n/);
    expect(header!.split(",")).not.toContain("variant_servings");
  });
});
