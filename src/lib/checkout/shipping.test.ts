import { describe, expect, it } from "vitest";

import { effectiveShippingPrice, preferredRate, type RateOption } from "./shipping";

const express: RateOption = {
  rate_id: "express",
  type: "flat",
  price: 7900,
  free_over_subtotal: null,
};
const standard: RateOption = {
  rate_id: "std",
  type: "free_over",
  price: 9900,
  free_over_subtotal: 60000,
};
const pickup: RateOption = {
  rate_id: "pickup",
  type: "pickup",
  price: 0,
  free_over_subtotal: null,
};

describe("tarifa preseleccionada", () => {
  it("con el envío gratis alcanzado, la tarifa «gratis desde» cuesta 0 y gana", () => {
    const cart = { subtotal: 70000, discount_total: 0 };
    expect(effectiveShippingPrice(standard, cart)).toBe(0);
    expect(preferredRate([express, standard], cart)?.rate_id).toBe("std");
  });

  it("sin alcanzarlo, gana la más barata por su precio", () => {
    expect(
      preferredRate([express, standard], { subtotal: 50000, discount_total: 0 })?.rate_id,
    ).toBe("express");
  });

  it("el umbral se mide sobre el subtotal ya descontado, como la base", () => {
    expect(effectiveShippingPrice(standard, { subtotal: 70000, discount_total: 15000 })).toBe(9900);
  });

  it("recoger en tienda solo si no hay envío a domicilio", () => {
    const cart = { subtotal: 1000, discount_total: 0 };
    expect(preferredRate([pickup, express], cart)?.rate_id).toBe("express");
    expect(preferredRate([pickup], cart)?.rate_id).toBe("pickup");
    expect(preferredRate([], cart)).toBeUndefined();
  });
});
