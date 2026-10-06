/**
 * Contrato de proveedor de pagos de la TIENDA (GATE0 §18.2, contrato crítico §43).
 * Fase 6: `manual` y `fake`. Stripe Connect llega en la F7 con el mismo contrato.
 * Ninguna llamada de un adaptador ocurre dentro de una transacción de base de datos.
 */
export type PaymentProviderKey = "manual" | "fake";

export interface Money {
  /** Centavos (bigint en la base; aquí siempre entero seguro). */
  amount: number;
  currency: string;
}

export interface PaymentAccountCredentials {
  id: string;
  provider: PaymentProviderKey;
  mode: "test" | "live";
  publicConfig: Record<string, unknown>;
}

export interface CheckoutLine {
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateCheckoutInput {
  account: PaymentAccountCredentials;
  payment: { id: string } & Money;
  order: { id: string; displayNumber: string; items: CheckoutLine[] };
  buyer: { email: string; name?: string };
  returnUrls: { success: string; pending: string; failure: string };
  expiresAt: Date;
  idempotencyKey: string;
}

export interface CreateCheckoutResult {
  providerCheckoutId: string;
  /** A dónde mandar al comprador; sin URL, el pedido muestra las instrucciones de pago. */
  redirectUrl?: string;
}

export type NormalizedPaymentStatus =
  | "pending"
  | "authorized"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "partially_refunded";

export interface NormalizedPayment {
  providerPaymentId: string;
  status: NormalizedPaymentStatus;
  amount: number;
  currency: string;
  /** = payments.id */
  externalReference: string;
  method?: string;
  failureCode?: string;
}

export type WebhookVerification =
  | { ok: true; eventId: string; type: string; providerPaymentId?: string; signedAt: Date }
  | { ok: false; reason: "bad_signature" | "stale" | "malformed" };

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  readonly capabilities: {
    redirectCheckout: boolean;
    embeddedCheckout: boolean;
    delayedMethods: boolean;
    refunds: boolean;
    partialRefunds: boolean;
    providerSideExpiration: boolean;
  };
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(input: {
    account: PaymentAccountCredentials;
    headers: Headers;
    rawBody: string;
    now: Date;
  }): Promise<WebhookVerification>;
}
