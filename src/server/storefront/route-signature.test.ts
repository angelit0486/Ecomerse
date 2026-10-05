import { describe, expect, it } from "vitest";

import { signStoreRoute, verifyStoreRoute } from "./route-signature";

const SECRET = "p".repeat(32);
const A = "0190a0d0-0000-7000-8000-00000000000a";
const B = "0190a0d0-0000-7000-8000-00000000000b";

describe("firma de la ruta interna /_store", () => {
  it("verifica la tienda y el modo", () => {
    expect(verifyStoreRoute(SECRET, A, signStoreRoute(SECRET, A, false))).toEqual({
      preview: false,
    });
    expect(verifyStoreRoute(SECRET, A, signStoreRoute(SECRET, A, true))).toEqual({ preview: true });
  });

  it("rechaza otra tienda, otro secreto o ausencia de firma", () => {
    expect(verifyStoreRoute(SECRET, B, signStoreRoute(SECRET, A, false))).toBeNull();
    expect(verifyStoreRoute("x".repeat(32), A, signStoreRoute(SECRET, A, false))).toBeNull();
    expect(verifyStoreRoute(SECRET, A, null)).toBeNull();
    expect(verifyStoreRoute(SECRET, A, "1")).toBeNull();
  });
});
