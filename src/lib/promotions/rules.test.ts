import { describe, expect, it } from "vitest";

import { describePromotion, promotionRules, rulesValid } from "./rules";

describe("reglas de promociones (espejo de app.promotion_rules_valid)", () => {
  it.each([
    ["buy_n_pay_m", { buy: 3, pay: 2 }, true],
    ["buy_n_pay_m", { buy: 3, pay: 3 }, false],
    ["buy_n_pay_m", { buy: 3, pay: 0 }, false],
    ["buy_n_pay_m", { buy: 21, pay: 2 }, false],
    ["buy_n_pay_m", { buy: 3, pay: 2, extra: 1 }, false],
    ["nth_percent", { nth: 2, percent_bps: 5000 }, true],
    ["nth_percent", { nth: 2, percent_bps: 10000 }, true],
    ["nth_percent", { nth: 1, percent_bps: 5000 }, false],
    ["nth_percent", { nth: 2, percent_bps: 10001 }, false],
    ["nth_percent", { nth: 2.5, percent_bps: 5000 }, false],
    [
      "volume",
      {
        mode: "unit_price",
        tiers: [
          { min_qty: 5, value: 9000 },
          { min_qty: 10, value: 8000 },
        ],
      },
      true,
    ],
    [
      "volume",
      {
        mode: "unit_price",
        tiers: [
          { min_qty: 5, value: 9000 },
          { min_qty: 10, value: 9500 },
        ],
      },
      false,
    ],
    [
      "volume",
      {
        mode: "percent",
        tiers: [
          { min_qty: 3, value: 1000 },
          { min_qty: 6, value: 2000 },
        ],
      },
      true,
    ],
    [
      "volume",
      {
        mode: "percent",
        tiers: [
          { min_qty: 3, value: 2000 },
          { min_qty: 6, value: 1000 },
        ],
      },
      false,
    ],
    ["volume", { mode: "percent", tiers: [{ min_qty: 3, value: 10000 }] }, false],
    ["volume", { mode: "percent", tiers: [{ min_qty: 1, value: 1000 }] }, false],
    [
      "volume",
      {
        mode: "percent",
        tiers: [
          { min_qty: 3, value: 1000 },
          { min_qty: 3, value: 2000 },
        ],
      },
      false,
    ],
    ["volume", { mode: "percent", tiers: [] }, false],
    [
      "volume",
      {
        mode: "percent",
        tiers: Array.from({ length: 6 }, (_, i) => ({ min_qty: i + 2, value: i + 1 })),
      },
      false,
    ],
    ["2x1", {}, false],
  ] as const)("%s %j → %s", (type, rules, ok) => {
    expect(rulesValid(type, rules)).toBe(ok);
  });

  it("describe cada promoción en español", () => {
    const d = (x: unknown) => describePromotion(promotionRules.parse(x));
    expect(d({ type: "buy_n_pay_m", rules: { buy: 3, pay: 2 } })).toBe("Lleva 3, paga 2");
    expect(d({ type: "nth_percent", rules: { nth: 2, percent_bps: 5000 } })).toBe(
      "La segunda al 50% de descuento",
    );
    expect(d({ type: "nth_percent", rules: { nth: 3, percent_bps: 10000 } })).toBe(
      "La tercera gratis",
    );
    expect(d({ type: "nth_percent", rules: { nth: 7, percent_bps: 2550 } })).toBe(
      "La pieza 7 al 25.5% de descuento",
    );
    expect(
      d({ type: "volume", rules: { mode: "percent", tiers: [{ min_qty: 5, value: 1000 }] } }),
    ).toBe("Desde 5: 10% de descuento");
    expect(
      d({ type: "volume", rules: { mode: "unit_price", tiers: [{ min_qty: 12, value: 8500 }] } }),
    ).toMatch(/^Desde 12: \$85\.00 c\/u$/);
  });
});
