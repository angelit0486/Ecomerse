import { describe, expect, it } from "vitest";

import { isCheckoutPath } from "./checkout-chrome";

describe("isCheckoutPath", () => {
  it("solo la página de pago usa el encabezado mínimo", () => {
    expect(isCheckoutPath("/checkout")).toBe(true);
    expect(isCheckoutPath("/checkout/")).toBe(true);
    expect(isCheckoutPath("/carrito")).toBe(false);
    expect(isCheckoutPath("/checkouts")).toBe(false);
    expect(isCheckoutPath(null)).toBe(false);
  });
});
