import { describe, expect, it } from "vitest";

import { createPreviewToken, PREVIEW_TTL_SECONDS, verifyPreviewToken } from "./preview";

const SECRET = "s".repeat(32);
const STORE = "0190a0d0-0000-7000-8000-00000000000a";
const NOW = 1_800_000_000;

describe("token de vista previa (CF-09)", () => {
  it("se verifica con el mismo secreto y devuelve la tienda", () => {
    const token = createPreviewToken(SECRET, STORE, NOW);
    expect(verifyPreviewToken(SECRET, token, NOW + 10)).toEqual({
      storeId: STORE,
      exp: NOW + PREVIEW_TTL_SECONDS,
    });
  });

  it("caduca a los 15 minutos", () => {
    const token = createPreviewToken(SECRET, STORE, NOW);
    expect(verifyPreviewToken(SECRET, token, NOW + PREVIEW_TTL_SECONDS)).toBeNull();
  });

  it("rechaza otro secreto, manipulación de la tienda o de la caducidad", () => {
    const token = createPreviewToken(SECRET, STORE, NOW);
    expect(verifyPreviewToken("x".repeat(32), token, NOW)).toBeNull();
    const [, exp, nonce, sig] = token.split(".");
    const otherStore = "0190a0d0-0000-7000-8000-00000000000b";
    expect(verifyPreviewToken(SECRET, `${otherStore}.${exp}.${nonce}.${sig}`, NOW)).toBeNull();
    expect(
      verifyPreviewToken(SECRET, `${STORE}.${Number(exp) + 600}.${nonce}.${sig}`, NOW),
    ).toBeNull();
  });

  it("rechaza caducidades más allá del máximo aunque estén firmadas", () => {
    const token = createPreviewToken(SECRET, STORE, NOW + 3600);
    expect(verifyPreviewToken(SECRET, token, NOW)).toBeNull();
  });

  it.each([null, "", "a.b.c", "x".repeat(300)])("rechaza basura: %s", (token) => {
    expect(verifyPreviewToken(SECRET, token, NOW)).toBeNull();
  });

  it("dos tokens de la misma tienda son distintos (nonce)", () => {
    expect(createPreviewToken(SECRET, STORE, NOW)).not.toBe(createPreviewToken(SECRET, STORE, NOW));
  });
});
