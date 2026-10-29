import { describe, expect, it } from "vitest";

import {
  percentChange,
  previewChangesSchema,
  priceSummary,
  stockSummary,
  type PreviewChanges,
} from "./preview-changes";

const base: PreviewChanges = {
  price_changes: 0,
  price_up: 0,
  price_down: 0,
  price_examples: [],
  stock_visible: true,
  stock_changes: 0,
  stock_examples: [],
  unmatched_variants: 0,
  status_changes: 0,
};

describe("resumen de cambios de una importación", () => {
  it("valida la respuesta de la base (también sin permiso de inventario)", () => {
    expect(previewChangesSchema.parse(base)).toEqual(base);
    expect(
      previewChangesSchema.parse({
        ...base,
        stock_visible: false,
        stock_changes: null,
        stock_examples: null,
      }).stock_changes,
    ).toBeNull();
    expect(() => previewChangesSchema.parse({ ...base, price_changes: -1 })).toThrow();
  });

  it("precios: dice cuántos cambian y en qué sentido", () => {
    expect(priceSummary(base)).toBe("Ningún precio cambia.");
    expect(priceSummary({ ...base, price_changes: 1, price_up: 1 })).toBe(
      "1 precio cambia: 1 sube.",
    );
    expect(priceSummary({ ...base, price_changes: 12, price_up: 10, price_down: 2 })).toBe(
      "12 precios cambian: 10 suben y 2 bajan.",
    );
  });

  it("existencias: se omite si no se pueden ver", () => {
    expect(stockSummary(base)).toBe("Ninguna existencia cambia.");
    expect(stockSummary({ ...base, stock_changes: 3 })).toBe(
      "3 presentaciones cambian de existencias.",
    );
    expect(stockSummary({ ...base, stock_changes: 1 })).toBe(
      "1 presentación cambia de existencias.",
    );
    expect(stockSummary({ ...base, stock_visible: false, stock_changes: null })).toBeNull();
  });

  it("porcentaje con signo; sin precio de hoy no se inventa", () => {
    expect(percentChange(10000, 11000)).toBe("+10 %");
    expect(percentChange(10000, 9700)).toBe("−3 %");
    expect(percentChange(10000, 10001)).toBe("+<1 %");
    expect(percentChange(null, 5000)).toBeNull();
    expect(percentChange(0, 5000)).toBeNull();
  });
});
