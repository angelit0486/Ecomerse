import { describe, expect, it } from "vitest";

import { createFakeProvider } from "./fake";
import { manualProvider } from "./manual";
import {
  fakePaymentSignature,
  guestToken,
  isGuestTokenShape,
  isOrderReturnPath,
  tokenHash,
  verifyFakePaymentSignature,
} from "./order-links";
import type { CreateCheckoutInput } from "./provider";

const SECRET = "s".repeat(32);
const PAYMENT = "0190a0d0-0000-7000-8000-000000000001";
const BACK = `/pedido/0190a0d0-0000-7000-8000-00000000000a?t=${"a".repeat(43)}`;

const input: CreateCheckoutInput = {
  account: { id: "a", provider: "fake", mode: "test", publicConfig: {} },
  payment: { id: PAYMENT, amount: 10000, currency: "MXN" },
  order: { id: "o", displayNumber: "#1001", items: [] },
  buyer: { email: "a@b.io" },
  returnUrls: {
    success: `https://tienda.example.com${BACK}`,
    pending: `https://tienda.example.com${BACK}`,
    failure: `https://tienda.example.com${BACK}`,
  },
  expiresAt: new Date(),
  idempotencyKey: PAYMENT,
};

describe("enlaces del pedido", () => {
  it("el token del invitado es estable por clave e imposible de adivinar sin el secreto", () => {
    const a = guestToken(SECRET, "idem-000000000000001");
    expect(a).toBe(guestToken(SECRET, "idem-000000000000001"));
    expect(a).not.toBe(guestToken(SECRET, "idem-000000000000002"));
    expect(a).not.toBe(guestToken("t".repeat(32), "idem-000000000000001"));
    expect(isGuestTokenShape(a)).toBe(true);
    expect(tokenHash(a)).toHaveLength(32);
    expect(() => guestToken(SECRET, "corta")).toThrow();
  });

  it("la firma del pago simulado cubre el pago y la ruta de regreso", () => {
    const sig = fakePaymentSignature(SECRET, PAYMENT, BACK);
    expect(verifyFakePaymentSignature(SECRET, PAYMENT, BACK, sig)).toBe(true);
    expect(verifyFakePaymentSignature(SECRET, PAYMENT, `${BACK}x`, sig)).toBe(false);
    expect(
      verifyFakePaymentSignature(SECRET, "0190a0d0-0000-7000-8000-000000000002", BACK, sig),
    ).toBe(false);
    expect(verifyFakePaymentSignature(SECRET, PAYMENT, BACK, null)).toBe(false);
    // Ninguna ruta ajena al pedido sirve de regreso (sin redirección abierta).
    expect(isOrderReturnPath("//evil.example.com/pedido")).toBe(false);
    expect(isOrderReturnPath("https://evil.example.com")).toBe(false);
    expect(() => fakePaymentSignature(SECRET, PAYMENT, "/admin")).toThrow();
  });
});

describe("adaptadores de pago", () => {
  it("manual: sin redirección (el pedido muestra las instrucciones)", async () => {
    const r = await manualProvider.createCheckout({
      ...input,
      account: { ...input.account, provider: "manual" },
    });
    expect(r).toEqual({ providerCheckoutId: `manual_${PAYMENT}` });
  });

  it("fake: redirige a la página firmada de la misma tienda y vuelve al pedido", async () => {
    const r = await createFakeProvider(SECRET).createCheckout(input);
    const url = new URL(r.redirectUrl!);
    expect(url.origin).toBe("https://tienda.example.com");
    expect(url.pathname).toBe(`/pago-simulado/${PAYMENT}`);
    expect(url.searchParams.get("volver")).toBe(BACK);
    expect(
      verifyFakePaymentSignature(
        SECRET,
        PAYMENT,
        url.searchParams.get("volver"),
        url.searchParams.get("firma"),
      ),
    ).toBe(true);
  });

  it("ningún adaptador de la F6 acepta webhooks", async () => {
    const args = { account: input.account, headers: new Headers(), rawBody: "{}", now: new Date() };
    expect(await manualProvider.verifyWebhook(args)).toEqual({ ok: false, reason: "malformed" });
    expect(await createFakeProvider(SECRET).verifyWebhook(args)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
