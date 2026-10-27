import { describe, expect, it } from "vitest";

import { paymentBadges } from "./payment-badges";

describe("paymentBadges", () => {
  it("suma Mercado Pago cuando está activo y no repite", () => {
    expect(paymentBadges(["visa"], ["mercadopago"])).toEqual(["visa", "mercado_pago"]);
    expect(paymentBadges(["mercado_pago"], ["mercadopago"])).toEqual(["mercado_pago"]);
  });

  it("no inventa insignias para pagos manuales o simulados", () => {
    expect(paymentBadges([], ["manual", "fake"])).toEqual([]);
  });
});
