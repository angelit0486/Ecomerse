import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { rulesValid } from "@/lib/promotions/rules";

/** El formulario (TS) y la base (app.promotion_rules_valid) aceptan exactamente lo mismo (ADR-070). */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
afterAll(async () => {
  await admin.end();
});

const tiers = (mode: string, t: [number, number][]) => ({
  mode,
  tiers: t.map(([min_qty, value]) => ({ min_qty, value })),
});

const cases: [string, unknown][] = [
  ["buy_n_pay_m", { buy: 3, pay: 2 }],
  ["buy_n_pay_m", { buy: 20, pay: 19 }],
  ["buy_n_pay_m", { buy: 2, pay: 2 }],
  ["buy_n_pay_m", { buy: 1, pay: 0 }],
  ["buy_n_pay_m", { buy: 21, pay: 1 }],
  ["buy_n_pay_m", { buy: "3", pay: 2 }],
  ["buy_n_pay_m", { buy: 3 }],
  ["buy_n_pay_m", [3, 2]],
  ["nth_percent", { nth: 2, percent_bps: 5000 }],
  ["nth_percent", { nth: 20, percent_bps: 10000 }],
  ["nth_percent", { nth: 2, percent_bps: 0 }],
  ["nth_percent", { nth: 21, percent_bps: 100 }],
  ["nth_percent", { nth: 2, percent_bps: -5 }],
  ["volume", tiers("unit_price", [[5, 9000]])],
  [
    "volume",
    tiers("unit_price", [
      [5, 9000],
      [10, 8000],
      [20, 7000],
    ]),
  ],
  [
    "volume",
    tiers("unit_price", [
      [5, 9000],
      [10, 9000],
    ]),
  ],
  ["volume", tiers("unit_price", [[5, 0]])],
  ["volume", tiers("unit_price", [[999, 1]])],
  ["volume", tiers("unit_price", [[1000, 1]])],
  ["volume", tiers("percent", [[3, 9999]])],
  ["volume", tiers("percent", [[3, 10000]])],
  [
    "volume",
    tiers("percent", [
      [3, 1000],
      [2, 2000],
    ]),
  ],
  [
    "volume",
    tiers("percent", [
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]),
  ],
  [
    "volume",
    tiers("percent", [
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
      [7, 6],
    ]),
  ],
  ["volume", { mode: "fixed", tiers: [{ min_qty: 3, value: 1 }] }],
  ["volume", { mode: "percent", tiers: [{ min_qty: 3, value: 1, x: 1 }] }],
  ["otro", { buy: 3, pay: 2 }],
];

describe("reglas de promociones: formulario = base", () => {
  it.each(cases)("%s %j", async (type, rules) => {
    const [row] = await admin<{ ok: boolean }[]>`
      select app.promotion_rules_valid(${type}, ${admin.json(rules as never)}) as ok`;
    expect(rulesValid(type, rules)).toBe(row!.ok);
  });
});
