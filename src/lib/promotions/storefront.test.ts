import { describe, expect, it } from "vitest";

import {
  cartLinePromotionNotes,
  linePromotionSavings,
  promotionBadge,
  promotionDetails,
} from "./storefront";

describe("promotionBadge", () => {
  it("N×M, N-ésima y mayoreo en pocas palabras", () => {
    expect(promotionBadge({ type: "buy_n_pay_m", rules: { buy: 3, pay: 2 } })).toBe(
      "Lleva 3, paga 2",
    );
    expect(promotionBadge({ type: "nth_percent", rules: { nth: 2, percent_bps: 5000 } })).toBe(
      "2a al 50%",
    );
    expect(promotionBadge({ type: "nth_percent", rules: { nth: 3, percent_bps: 10000 } })).toBe(
      "3a gratis",
    );
    expect(
      promotionBadge({
        type: "volume",
        rules: { mode: "unit_price", tiers: [{ min_qty: 6, value: 15000 }] },
      }),
    ).toBe("Mayoreo desde 6 pzas");
  });

  it("una regla que no entiende no se anuncia", () => {
    expect(promotionBadge({ type: "buy_n_pay_m", rules: { buy: 2, pay: 2 } })).toBeNull();
    expect(promotionBadge({ type: "otra", rules: {} })).toBeNull();
  });
});

describe("promotionDetails", () => {
  it("explica cada escalón del mayoreo", () => {
    const [d] = promotionDetails([
      {
        id: "a",
        label: "Mayoreo playeras",
        type: "volume",
        rules: {
          mode: "unit_price",
          tiers: [
            { min_qty: 6, value: 15000 },
            { min_qty: 12, value: 13000 },
          ],
        },
      },
    ]);
    expect(d).toEqual({
      id: "a",
      label: "Mayoreo playeras",
      summary: "Precio de mayoreo",
      tiers: ["6 piezas o más: $150.00 c/u", "12 piezas o más: $130.00 c/u"],
    });
  });

  it("porcentaje, N×M y N-ésima; omite las inválidas", () => {
    const out = promotionDetails([
      {
        id: "p",
        label: "x",
        type: "volume",
        rules: { mode: "percent", tiers: [{ min_qty: 3, value: 1000 }] },
      },
      { id: "n", label: "3×2", type: "buy_n_pay_m", rules: { buy: 3, pay: 2 } },
      { id: "s", label: "2a", type: "nth_percent", rules: { nth: 2, percent_bps: 5000 } },
      { id: "bad", label: "x", type: "volume", rules: { mode: "percent", tiers: [] } },
    ]);
    expect(out.map((d) => [d.id, d.summary, d.tiers])).toEqual([
      ["p", "Precio de mayoreo", ["3 piezas o más: 10% de descuento"]],
      ["n", "Lleva 3, paga 2", []],
      ["s", "La segunda al 50% de descuento", []],
    ]);
  });

  it("sin promociones, nada", () => {
    expect(promotionDetails(undefined)).toEqual([]);
  });
});

describe("linePromotionSavings", () => {
  it("solo el entero positivo que mandó la base", () => {
    expect(linePromotionSavings({ promotion_allocation: 10000 })).toBe(10000);
    expect(linePromotionSavings({ promotion_allocation: 0 })).toBe(0);
    expect(linePromotionSavings({})).toBe(0);
    expect(linePromotionSavings({ promotion_allocation: -5 })).toBe(0);
    expect(linePromotionSavings({ promotion_allocation: 1.5 })).toBe(0);
  });
});

describe("cartLinePromotionNotes", () => {
  it("nombra cada promoción de la línea con su monto", () => {
    expect(
      cartLinePromotionNotes({ promotions: [{ promotion_id: "a", units: 1, amount: 10000 }] }, [
        { promotion_id: "a", label: "3×2 en playeras", amount: 10000 },
      ]),
    ).toEqual([{ label: "3×2 en playeras", amount: 10000 }]);
  });

  it("sin leyenda conocida dice «Promoción»; sin promociones, nada", () => {
    expect(
      cartLinePromotionNotes({ promotions: [{ promotion_id: "z", units: 1, amount: 5 }] }, []),
    ).toEqual([{ label: "Promoción", amount: 5 }]);
    expect(cartLinePromotionNotes({}, undefined)).toEqual([]);
    expect(
      cartLinePromotionNotes({ promotions: [{ promotion_id: "a", units: 1, amount: 0 }] }, []),
    ).toEqual([]);
  });
});
