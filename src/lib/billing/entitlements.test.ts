import { describe, expect, it } from "vitest";

import { billingSchema, keyDate, LIMIT_KEYS, LIMIT_LABELS, usagePercent } from "./entitlements";

describe("registro de límites", () => {
  it("cada límite tiene su nombre en español", () => {
    for (const key of LIMIT_KEYS) expect(LIMIT_LABELS[key]).toBeTruthy();
  });
});

describe("keyDate", () => {
  it("muestra la fecha que importa según el estado", () => {
    expect(keyDate({ status: "trialing", trial_ends_at: "2026-11-01" })).toEqual({
      label: "La prueba termina",
      at: "2026-11-01",
    });
    expect(keyDate({ status: "past_due", grace_ends_at: "2026-11-02" })?.label).toBe(
      "Paga antes de",
    );
    expect(keyDate({ status: "active", current_period_end: "2026-12-01" })?.label).toBe(
      "Pagado hasta",
    );
    expect(keyDate({ status: "active" })).toBeNull();
    expect(keyDate(null)).toBeNull();
  });
});

describe("usagePercent", () => {
  it("redondea y topa en 100", () => {
    expect(usagePercent(25, 100)).toBe(25);
    expect(usagePercent(150, 100)).toBe(100);
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(1, 0)).toBe(100);
    expect(usagePercent(null, 10)).toBeNull();
  });
});

describe("billingSchema", () => {
  it("acepta lo que devuelve la base", () => {
    const parsed = billingSchema.parse({
      organization_id: "01a1809d-0ffe-7668-b874-013f63a9447b",
      access_mode: "full",
      plan: { key: "basico", name: "Básico" },
      subscription: { status: "active", current_period_end: "2026-12-01T00:00:00+00:00" },
      entitlements: {
        max_products: { type: "int", value: 100, used: 4, override: false },
        custom_domains: { type: "bool", value: true, used: null, override: false },
      },
    });
    expect(parsed.entitlements.max_products?.used).toBe(4);
  });
});
