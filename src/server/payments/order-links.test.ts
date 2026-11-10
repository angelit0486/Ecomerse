import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { guestToken, isGuestTokenShape } from "./order-links";

const SECRET = "s".repeat(32);
const KEY = "checkout-key-0123456789";

describe("token del enlace del invitado (ADR-062)", () => {
  it("la generación 0 es el token de siempre: los correos ya enviados siguen valiendo", () => {
    const before = createHmac("sha256", SECRET).update(`order-guest:${KEY}`).digest("base64url");
    expect(guestToken(SECRET, KEY)).toBe(before);
    expect(guestToken(SECRET, KEY, 0)).toBe(before);
  });

  it("cada generación da otro token, estable y con la forma de siempre", () => {
    const g1 = guestToken(SECRET, KEY, 1);
    const g2 = guestToken(SECRET, KEY, 2);
    expect(g1).not.toBe(guestToken(SECRET, KEY));
    expect(g2).not.toBe(g1);
    expect(guestToken(SECRET, KEY, 1)).toBe(g1);
    expect(isGuestTokenShape(g1)).toBe(true);
    expect(isGuestTokenShape(g2)).toBe(true);
  });

  it("rechaza una generación que no es un entero de 0 a 10 000", () => {
    for (const bad of [-1, 1.5, 10_001, Number.NaN]) {
      expect(() => guestToken(SECRET, KEY, bad)).toThrow("generación inválida");
    }
  });
});
