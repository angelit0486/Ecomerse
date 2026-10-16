import { describe, expect, it } from "vitest";

import {
  parsePriceFilter,
  priceFilterCents,
  priceFilterLabel,
  priceFilterPairs,
} from "./price-filter";

describe("parsePriceFilter", () => {
  it("lee pesos enteros y la oferta", () => {
    expect(parsePriceFilter({ precio_min: "200", precio_max: "500", oferta: "1" })).toEqual({
      min: 200,
      max: 500,
      onSale: true,
    });
  });
  it("ignora valores inválidos y voltea un rango al revés", () => {
    expect(parsePriceFilter({ precio_min: "-3", precio_max: "abc" })).toEqual({ onSale: false });
    expect(parsePriceFilter({ precio_min: "900", precio_max: "100" })).toMatchObject({
      min: 100,
      max: 900,
    });
    expect(parsePriceFilter({ precio_min: ["1", "2"], oferta: "si" })).toEqual({ onSale: false });
  });
  it("pasa a centavos con el último peso incluido", () => {
    expect(priceFilterCents({ min: 200, max: 500, onSale: false })).toEqual({
      minPrice: 20000,
      maxPrice: 50099,
    });
  });
  it("pares estables y etiquetas", () => {
    const f = { min: 200, onSale: true };
    expect(priceFilterPairs(f)).toEqual([
      ["precio_min", "200"],
      ["oferta", "1"],
    ]);
    const fmt = (n: number) => `$${n}`;
    expect(priceFilterLabel(f, fmt)).toBe("Desde $200");
    expect(priceFilterLabel({ max: 500, onSale: false }, fmt)).toBe("Hasta $500");
    expect(priceFilterLabel({ min: 1, max: 2, onSale: false }, fmt)).toBe("$1 a $2");
  });
});
