import { describe, expect, it } from "vitest";

import { MX_STATES, stateForPostalCode } from "./mx-states";
import {
  effectiveShippingPrice,
  preferredRate,
  shippingEstimate,
  type RateOption,
} from "./shipping";

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

describe("shippingEstimate: el envío antes de la dirección", () => {
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const promo = { free_over: 99900, conditional: false, price: 9900 };
  it("sin promoción no estima", () => {
    expect(shippingEstimate(null, { subtotal: 49900, discount_total: 0 }, fmt)).toBeUndefined();
  });
  it("debajo del umbral muestra el costo y desde cuánto es gratis", () => {
    expect(shippingEstimate(promo, { subtotal: 49900, discount_total: 0 }, fmt)).toBe(
      "$99.00 (gratis desde $999.00)",
    );
  });
  it("con el umbral alcanzado (ya descontado) es gratis", () => {
    expect(shippingEstimate(promo, { subtotal: 99900, discount_total: 0 }, fmt)).toBe("Gratis");
    expect(shippingEstimate(promo, { subtotal: 100000, discount_total: 200 }, fmt)).toBe(
      "$99.00 (gratis desde $999.00)",
    );
  });
  it("si depende de la región lo dice", () => {
    expect(
      shippingEstimate({ ...promo, conditional: true }, { subtotal: 1, discount_total: 0 }, fmt),
    ).toBe("Según tu dirección (gratis desde $999.00)");
  });
});

describe("MX_STATES", () => {
  it("son los 32 estados, sin repetir", () => {
    expect(MX_STATES).toHaveLength(32);
    expect(new Set(MX_STATES).size).toBe(32);
    expect(MX_STATES).toContain("Nuevo León");
  });
});

describe("stateForPostalCode", () => {
  it("deduce el estado por los dos primeros dígitos", () => {
    expect(stateForPostalCode("72000")).toBe("Puebla");
    expect(stateForPostalCode("64000")).toBe("Nuevo León");
    expect(stateForPostalCode("06600")).toBe("Ciudad de México");
    expect(stateForPostalCode("23000")).toBe("Baja California Sur");
    expect(stateForPostalCode("80000")).toBe("Sinaloa");
  });
  it("sin 5 dígitos o fuera de rango no adivina", () => {
    expect(stateForPostalCode("720")).toBeNull();
    expect(stateForPostalCode("19000")).toBeNull();
    expect(stateForPostalCode("abcde")).toBeNull();
  });
  it("cada estado tiene al menos un rango", () => {
    const covered = new Set(
      Array.from({ length: 100 }, (_, i) => stateForPostalCode(`${String(i).padStart(2, "0")}000`)),
    );
    for (const state of MX_STATES) expect(covered).toContain(state);
  });
});
