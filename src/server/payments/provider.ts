/**
 * Contrato de proveedor de pagos de la TIENDA (GATE0 §18.2, contrato crítico §43).
 * `manual`, `fake` (F6), `stripe` (Connect, F7) y `mercadopago` (Checkout Pro,
 * ADR-028) con el mismo contrato.
 * Ninguna llamada de un adaptador ocurre dentro de una transacción de base de datos.
 */
import { AppError } from "@/server/errors";

export type PaymentProviderKey = "manual" | "fake" | "stripe" | "mercadopago";

/** Respuesta HTTP no exitosa de un proveedor; `rejected` distingue rechazos (4xx) de fallas (5xx). */
export class ProviderHttpError extends AppError {
  constructor(
    readonly httpStatus: number,
    provider: string,
    path: string,
    method: string,
  ) {
    super("provider_error", undefined, {
      cause: new Error(`${provider} ${method} ${path} → ${httpStatus}`),
    });
  }
  /** 4xx (salvo 409 y 429): la solicitud nunca va a prosperar con los mismos datos. */
  get rejected(): boolean {
    return (
      this.httpStatus >= 400 &&
      this.httpStatus < 500 &&
      this.httpStatus !== 409 &&
      this.httpStatus !== 429
    );
  }
}

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
  | {
      ok: true;
      eventId: string;
      type: string;
      providerPaymentId?: string;
      signedAt: Date;
      /** Cuenta del proveedor que originó el evento (Connect: `acct_…`). Extensión aditiva, D-F7-01. */
      account?: string;
      /** Sesión de checkout del evento, si la hay. */
      checkoutId?: string;
      /** Referencia propia (= payments.id) informada por el proveedor. */
      reference?: string;
      /** El evento es de modo real (Stripe `livemode`). */
      livemode?: boolean;
    }
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
