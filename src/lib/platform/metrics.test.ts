import { describe, expect, it } from "vitest";

import { metricsSchema, parseWindow, subscriptionRows } from "./metrics";

const sample = {
  days: 30,
  organizations: { total: 3, active: 2, new: 1 },
  subscriptions: { active: 2, trialing: 1 },
  mrr: [{ currency: "MXN", amount: 89817, subscriptions: 2 }],
  paying_without_price: 0,
  trials_ending_7d: 1,
  plans: [{ key: "basico", name: "Básico", organizations: 3 }],
  stores: { total: 4, live: 2, draft: 2, with_sales: 1 },
  sales: [{ currency: "MXN", orders: 3, net: 90000, refunded: 10000 }],
  top_stores: [{ store: "Tienda A", handle: "tienda-a", currency: "MXN", orders: 2, net: 70000 }],
};

describe("métricas de la plataforma", () => {
  it("valida la respuesta de la base", () => {
    expect(metricsSchema.parse(sample)).toEqual(sample);
    expect(() => metricsSchema.parse({ ...sample, organizations: { total: -1 } })).toThrow();
  });

  it("ventana de días: 7, 30, 90 o 365; lo demás vuelve a 30", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("365")).toBe(365);
    for (const v of [undefined, "", "15", "abc", "-30"]) expect(parseWindow(v)).toBe(30);
  });

  it("suscripciones en orden de negocio y en español", () => {
    expect(subscriptionRows({ paused: 1, active: 5, trialing: 2, raro: 1 })).toEqual([
      ["En prueba", 2],
      ["Activas", 5],
      ["Pausadas (solo lectura)", 1],
      ["raro", 1],
    ]);
  });
});
