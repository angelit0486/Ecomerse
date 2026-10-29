import { describe, expect, it } from "vitest";

import { cartRecoveryEmail } from "./cart-recovery";
import {
  emailHashHex,
  optoutPath,
  optoutSignature,
  recoverPath,
  verifyOptout,
} from "./cart-recovery-links";

const SECRET = "x".repeat(40);
const STORE = "0190a000-0000-7000-8000-000000000001";

describe("enlaces del recordatorio de carrito", () => {
  it("el hash ignora mayúsculas y espacios", () => {
    expect(emailHashHex(" Ana@Cliente.io ")).toBe(emailHashHex("ana@cliente.io"));
    expect(emailHashHex("ana@cliente.io")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("la baja lleva el hash firmado, nunca el correo", () => {
    const path = optoutPath(SECRET, STORE, "ana@cliente.io");
    expect(path).not.toContain("ana");
    const q = new URL(path, "https://t.test").searchParams;
    expect(verifyOptout(SECRET, STORE, q.get("h"), q.get("s"))).toBe(true);
  });

  it("rechaza firmas de otra tienda, otro secreto u otro correo", () => {
    const h = emailHashHex("ana@cliente.io");
    const s = optoutSignature(SECRET, STORE, h);
    expect(verifyOptout(SECRET, STORE.replace(/1$/, "2"), h, s)).toBe(false);
    expect(verifyOptout("y".repeat(40), STORE, h, s)).toBe(false);
    expect(verifyOptout(SECRET, STORE, emailHashHex("beto@cliente.io"), s)).toBe(false);
    expect(verifyOptout(SECRET, STORE, "ana@cliente.io", s)).toBe(false);
    expect(verifyOptout(SECRET, STORE, h, null)).toBe(false);
  });

  it("el enlace de recuperar codifica el token", () => {
    expect(recoverPath("abc_-")).toBe("/carrito/recuperar?t=abc_-");
  });
});

describe("correo del recordatorio", () => {
  const data = {
    storeName: 'Tienda "<b>"',
    items: Array.from({ length: 7 }, (_, i) => ({ title: `Prod <${i}>`, quantity: 1 })),
    recoverUrl: "https://t.test/carrito/recuperar?t=a",
    optoutUrl: 'https://t.test/carrito/recordatorios?h=1&s=2"><x',
  };

  it("escapa todo y resume más de cinco productos", () => {
    const m = cartRecoveryEmail(data, "c@x.test");
    expect(m.html).not.toContain("<b>");
    expect(m.html).not.toContain("<0>");
    expect(m.html).not.toContain('"><x');
    expect(m.html).toContain("y 2 productos más");
    expect(m.text).toContain("y 2 productos más");
    expect(m.subject).toBe("Tu carrito en Tienda b te espera");
    expect(m.fromName).toBe('Tienda "<b>"');
  });

  it("dice que es el único recordatorio y trae la baja", () => {
    const m = cartRecoveryEmail({ ...data, items: [{ title: "Taza", quantity: 2 }] }, "c@x.test");
    expect(m.text).toContain("único recordatorio");
    expect(m.text).toContain(data.optoutUrl);
    expect(m.html).toContain("date de baja aquí");
    expect(m.html).not.toContain("productos más");
    expect(m.text).toContain("Volver a mi carrito: https://t.test/carrito/recuperar?t=a");
  });
});
