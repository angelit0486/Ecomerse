import { describe, expect, it } from "vitest";

import { deliveryEstimate } from "./delivery-estimate";

const base = { placedAt: "2026-10-16T15:00:00Z", timeZone: "America/Mexico_City" };

describe("deliveryEstimate (revisión de conversión, B4)", () => {
  it("rango en el mismo mes", () => {
    expect(deliveryEstimate({ ...base, minDays: 2, maxDays: 5 })).toBe(
      "Llega entre el 18 y el 21 de octubre",
    );
  });

  it("rango que cruza de mes y un solo día", () => {
    expect(deliveryEstimate({ ...base, minDays: 14, maxDays: 17 })).toBe(
      "Llega entre el 30 de octubre y el 2 de noviembre",
    );
    expect(deliveryEstimate({ ...base, minDays: 1, maxDays: 1 })).toBe("Llega el 17 de octubre");
  });

  it("cuenta en el calendario de la tienda, no en UTC", () => {
    // 01:00 UTC del 17 es todavía el 16 en la Ciudad de México.
    expect(
      deliveryEstimate({ ...base, placedAt: "2026-10-17T01:00:00Z", minDays: 1, maxDays: 1 }),
    ).toBe("Llega el 17 de octubre");
    expect(
      deliveryEstimate({
        ...base,
        placedAt: "2026-10-17T01:00:00Z",
        timeZone: "UTC",
        minDays: 1,
        maxDays: 1,
      }),
    ).toBe("Llega el 18 de octubre");
  });

  it("sin datos o con datos inválidos no inventa una fecha", () => {
    expect(deliveryEstimate({ ...base, minDays: null, maxDays: 5 })).toBeNull();
    expect(deliveryEstimate({ ...base, minDays: 5, maxDays: 2 })).toBeNull();
    expect(deliveryEstimate({ ...base, minDays: -1, maxDays: 2 })).toBeNull();
    expect(deliveryEstimate({ ...base, minDays: 1.5, maxDays: 2 })).toBeNull();
    expect(deliveryEstimate({ ...base, placedAt: "x", minDays: 1, maxDays: 2 })).toBeNull();
    // Una zona inválida cae en UTC en lugar de romper la página.
    expect(deliveryEstimate({ ...base, timeZone: "Nada/Nada", minDays: 1, maxDays: 1 })).toBe(
      "Llega el 17 de octubre",
    );
  });
});
