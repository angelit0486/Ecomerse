import { fakePaymentSignature } from "./order-links";
import type { PaymentProvider } from "./provider";

/**
 * Proveedor simulado para desarrollo y pruebas E2E: redirige a una página de la
 * propia tienda que aprueba o rechaza el pago y vuelve al pedido. Nunca en
 * producción (lo impiden el registro y el ajuste de plataforma `payments.allow_fake`).
 */
export function createFakeProvider(secret: string): PaymentProvider {
  return {
    key: "fake",
    capabilities: {
      redirectCheckout: true,
      embeddedCheckout: false,
      delayedMethods: false,
      refunds: false,
      partialRefunds: false,
      providerSideExpiration: false,
    },
    async createCheckout(input) {
      const back = new URL(input.returnUrls.success);
      const returnPath = `${back.pathname}${back.search}`;
      const url = new URL(`/pago-simulado/${input.payment.id}`, back);
      url.search = new URLSearchParams({
        volver: returnPath,
        firma: fakePaymentSignature(secret, input.payment.id, returnPath),
      }).toString();
      return { providerCheckoutId: `fake_${input.payment.id}`, redirectUrl: url.toString() };
    },
    async verifyWebhook() {
      return { ok: false, reason: "malformed" };
    },
  };
}
