import type { PaymentProvider } from "./provider";

/**
 * Pago manual (transferencia, depósito, efectivo): no hay pasarela. El comprador
 * ve las instrucciones de la cuenta y el staff confirma el pago en el panel
 * (`orders_mark_paid_manual`, auditado).
 */
export const manualProvider: PaymentProvider = {
  key: "manual",
  capabilities: {
    redirectCheckout: false,
    embeddedCheckout: false,
    delayedMethods: true,
    refunds: false,
    partialRefunds: false,
    providerSideExpiration: false,
  },
  async createCheckout(input) {
    return { providerCheckoutId: `manual_${input.payment.id}` };
  },
  async verifyWebhook() {
    return { ok: false, reason: "malformed" };
  },
};
