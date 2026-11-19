import { describe, expect, it } from "vitest";

import { justPlacedTarget } from "./just-placed";

describe("marca de pedido recién confirmado", () => {
  it("solo en la página del pedido, conservando el enlace de acceso", () => {
    expect(justPlacedTarget("/pedido/abc?t=tok")).toBe("/pedido/abc?t=tok&nuevo=1");
    expect(justPlacedTarget("/pedido/abc")).toBe("/pedido/abc?nuevo=1");
  });

  it("a una pasarela de pago externa no se le agrega nada", () => {
    const mp = "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1";
    expect(justPlacedTarget(mp)).toBe(mp);
  });
});
