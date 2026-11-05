import { describe, expect, it } from "vitest";

import { paymentBadges } from "./payment-badges";

describe("paymentBadges", () => {
  it("suma Mercado Pago cuando está activo y no repite", () => {
    expect(paymentBadges(["visa"], ["mercadopago"])).toEqual(["visa", "mercado_pago"]);
    expect(paymentBadges(["mercado_pago"], ["mercadopago"])).toEqual(["mercado_pago"]);
  });

  it("ADR-059 (opción A): no anuncia OXXO, que hoy no se puede cobrar; SPEI sí (transferencia)", () => {
    expect(paymentBadges(["visa", "oxxo", "spei"], ["mercadopago"])).toEqual([
      "visa",
      "spei",
      "mercado_pago",
    ]);
  });

  it("no inventa insignias para pagos manuales o simulados", () => {
    expect(paymentBadges([], ["manual", "fake"])).toEqual([]);
  });
});
