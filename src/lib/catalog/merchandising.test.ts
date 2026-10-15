import { describe, expect, it } from "vitest";

import { NEW_DAYS, pricePerServing, productBadges, savings } from "./merchandising";

describe("savings", () => {
  it("calcula el ahorro en centavos y el porcentaje hacia abajo", () => {
    expect(savings(79900, 99900)).toEqual({ amount: 20000, percent: 20 });
    // 1/3 = 33.33… → 33 (nunca 34).
    expect(savings(200, 300)).toEqual({ amount: 100, percent: 33 });
    // 99.9 % → 99.
    expect(savings(1, 1000)).toEqual({ amount: 999, percent: 99 });
    // Menos de 1 %: el ahorro existe, el porcentaje es 0 (la UI no lo muestra).
    expect(savings(99950, 100000)).toEqual({ amount: 50, percent: 0 });
  });

  it("sin descuento real no hay ahorro", () => {
    expect(savings(1000, null)).toBeNull();
    expect(savings(1000, undefined)).toBeNull();
    expect(savings(1000, 1000)).toBeNull();
    expect(savings(1000, 900)).toBeNull();
    expect(savings(-1, 900)).toBeNull();
    expect(savings(1.5, 900)).toBeNull();
  });

  it("no pierde precisión con importes grandes", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(savings(big - 1, big)).toEqual({ amount: 1, percent: 0 });
  });
});

describe("pricePerServing", () => {
  it("divide y redondea al centavo (mitad hacia arriba)", () => {
    expect(pricePerServing(59900, 30)).toBe(1997); // 1996.67
    expect(pricePerServing(1000, 4)).toBe(250);
    expect(pricePerServing(5, 2)).toBe(3); // 2.5 → 3
    expect(pricePerServing(1, 3)).toBe(0); // 0.33 → 0
  });

  it("sin porciones declaradas o con datos inválidos, nada", () => {
    expect(pricePerServing(59900, null)).toBeNull();
    expect(pricePerServing(59900, undefined)).toBeNull();
    expect(pricePerServing(59900, 0)).toBeNull();
    expect(pricePerServing(59900, 1.5)).toBeNull();
    expect(pricePerServing(-1, 30)).toBeNull();
  });
});

describe("productBadges", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const base = {
    price: 1000,
    compareAt: null,
    availability: "in_stock" as const,
    publishedAt: null,
    now,
  };
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it("Oferta solo con precio de comparación mayor", () => {
    expect(productBadges({ ...base, compareAt: 1500 })).toEqual(["sale"]);
    expect(productBadges({ ...base, compareAt: 1000 })).toEqual([]);
    expect(productBadges({ ...base, price: null, compareAt: 1500 })).toEqual([]);
  });

  it(`Nuevo hasta ${NEW_DAYS} días después de publicarse`, () => {
    expect(productBadges({ ...base, publishedAt: daysAgo(0) })).toEqual(["new"]);
    expect(productBadges({ ...base, publishedAt: daysAgo(NEW_DAYS) })).toEqual(["new"]);
    expect(productBadges({ ...base, publishedAt: daysAgo(NEW_DAYS + 0.01) })).toEqual([]);
    // Fecha futura o inválida: no se inventa la insignia.
    expect(productBadges({ ...base, publishedAt: daysAgo(-1) })).toEqual([]);
    expect(productBadges({ ...base, publishedAt: "no es fecha" })).toEqual([]);
  });

  it("Últimas piezas con stock bajo; Agotado reemplaza a las demás", () => {
    expect(productBadges({ ...base, availability: "low_stock" })).toEqual(["low_stock"]);
    expect(
      productBadges({
        ...base,
        availability: "out_of_stock",
        compareAt: 1500,
        publishedAt: daysAgo(1),
      }),
    ).toEqual(["sold_out"]);
    expect(productBadges({ ...base, availability: "backorder" })).toEqual([]);
  });

  it("varias a la vez en orden estable", () => {
    expect(
      productBadges({
        ...base,
        availability: "low_stock",
        compareAt: 2000,
        publishedAt: daysAgo(3),
      }),
    ).toEqual(["sale", "new", "low_stock"]);
  });
});
