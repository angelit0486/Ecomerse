import { describe, expect, it } from "vitest";

import { constantTimeEqual, signPayload, verifySignedPayload } from "./hmac";

const secret = "s".repeat(40);
const now = 1_790_000_000;

describe("HMAC", () => {
  it("firma determinista en hexadecimal de 64 caracteres", () => {
    const a = signPayload(secret, now, "{}");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(signPayload(secret, now, "{}")).toBe(a);
    expect(signPayload(secret, now, '{"x":1}')).not.toBe(a);
  });

  it("verifica una firma válida dentro de la tolerancia", () => {
    const signature = signPayload(secret, now, "{}");
    expect(
      verifySignedPayload({
        secret,
        timestamp: String(now),
        signature,
        body: "{}",
        nowSeconds: now + 30,
      }),
    ).toBe(true);
  });

  it("rechaza replay fuera de la ventana, cuerpo alterado, otro secreto y formatos inválidos", () => {
    const signature = signPayload(secret, now, "{}");
    const base = { secret, timestamp: String(now), signature, body: "{}", nowSeconds: now };
    expect(verifySignedPayload({ ...base, nowSeconds: now + 61 })).toBe(false);
    expect(verifySignedPayload({ ...base, nowSeconds: now - 61 })).toBe(false);
    expect(verifySignedPayload({ ...base, body: '{"a":1}' })).toBe(false);
    expect(verifySignedPayload({ ...base, secret: "otro".repeat(10) })).toBe(false);
    expect(verifySignedPayload({ ...base, timestamp: null })).toBe(false);
    expect(verifySignedPayload({ ...base, signature: null })).toBe(false);
    expect(verifySignedPayload({ ...base, timestamp: "12a" })).toBe(false);
    expect(verifySignedPayload({ ...base, signature: signature.toUpperCase() })).toBe(false);
  });

  it("constantTimeEqual compara también cadenas de distinta longitud", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});
