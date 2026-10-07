import { createHmac } from "node:crypto";

import { AppError } from "@/server/errors";
import { constantTimeEqual } from "@/server/security/hmac";

import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedPayment,
  PaymentAccountCredentials,
  PaymentProvider,
  WebhookVerification,
} from "./provider";

/**
 * Stripe Connect con cuentas Standard y cargos directos (A-01): la tienda es el
 * merchant of record; la plataforma solo guarda el `stripe_account_id` y opera con
 * su clave secreta y la cabecera `Stripe-Account`. Sin SDK: REST con fetch
 * (form-encoded), tiempo máximo por llamada y clave de idempotencia.
 * Detalles verificados contra la documentación pública de Stripe; la prueba real
 * en sandbox queda pendiente del propietario (S-4, D-F7-02).
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  /** Tolerancia de la firma del webhook (§18.4: ±5 min). */
  toleranceSeconds?: number;
  fetchImpl?: typeof fetch;
}

const API_VERSION = "2024-06-20";
const ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,64}$/;
/** Stripe exige que una sesión de checkout viva entre 30 min y 24 h. */
const MIN_SESSION_SECONDS = 31 * 60;

type Scalar = string | number | boolean;
type Params = { [key: string]: Scalar | undefined | null | Params | Array<Params | Scalar> };

/** Codificación de Stripe para objetos anidados: a[b][0][c]=v. */
export function encodeForm(params: Params, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object") out.push(...encodeForm(item, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      out.push(...encodeForm(value, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

export function stripeAccountId(account: PaymentAccountCredentials): string {
  const id = account.publicConfig.stripe_account_id;
  if (typeof id !== "string" || !ACCOUNT_RE.test(id)) {
    throw new AppError("provider_error", "La cuenta de Stripe no está conectada.");
  }
  return id;
}

interface StripeSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string;
  client_reference_id: string | null;
  payment_method_types?: string[];
  payment_intent:
    string | { id: string; status: string; last_payment_error?: { code?: string } | null } | null;
}

export class StripeApi {
  constructor(private readonly cfg: StripeConfig) {}

  async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { params?: Params; account?: string; idempotencyKey?: string } = {},
  ): Promise<T> {
    const base = this.cfg.apiBase ?? "https://api.stripe.com";
    const body = options.params ? encodeForm(options.params).join("&") : undefined;
    const url = method === "GET" && body ? `${base}${path}?${body}` : `${base}${path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.secretKey}`,
      "stripe-version": API_VERSION,
    };
    if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
    if (options.account) headers["stripe-account"] = options.account;
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    let response: Response;
    try {
      response = await (this.cfg.fetchImpl ?? fetch)(url, {
        method,
        headers,
        ...(method === "POST" && body ? { body } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new AppError("provider_error", undefined, { cause: error });
    }
    if (!response.ok) {
      // El cuerpo de error de Stripe nunca llega al cliente (puede traer datos internos).
      throw new AppError("provider_error", undefined, {
        cause: new Error(`stripe ${method} ${path} → ${response.status}`),
      });
    }
    return (await response.json()) as T;
  }

  /** Onboarding (Account Links): crea la cuenta Standard de la tienda. */
  createAccount(
    email: string | null,
    country: string,
    idempotencyKey?: string,
  ): Promise<{ id: string }> {
    return this.request("POST", "/v1/accounts", {
      params: { type: "standard", country, ...(email ? { email } : {}) },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
  }

  createAccountLink(
    account: string,
    refreshUrl: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    if (!ACCOUNT_RE.test(account)) throw new AppError("validation_failed");
    return this.request("POST", "/v1/account_links", {
      params: {
        account,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      },
    });
  }

  async accountStatus(
    account: string,
  ): Promise<{ chargesEnabled: boolean; detailsSubmitted: boolean }> {
    if (!ACCOUNT_RE.test(account)) throw new AppError("validation_failed");
    const a = await this.request<{ charges_enabled: boolean; details_submitted: boolean }>(
      "GET",
      `/v1/accounts/${account}`,
    );
    return { chargesEnabled: a.charges_enabled, detailsSubmitted: a.details_submitted };
  }

  retrieveSession(account: string, sessionId: string): Promise<StripeSession> {
    if (!/^cs_[A-Za-z0-9_]{8,255}$/.test(sessionId)) throw new AppError("validation_failed");
    return this.request("GET", `/v1/checkout/sessions/${sessionId}`, {
      account,
      params: { expand: ["payment_intent"] },
    });
  }
}

/** Sesión de Stripe → pago normalizado (§18.2). */
export function normalizeSession(session: StripeSession): NormalizedPayment {
  const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : (pi?.id ?? "");
  let status: NormalizedPayment["status"];
  if (session.payment_status === "paid") status = "succeeded";
  else if (session.status === "expired") status = "expired";
  else if (pi?.status === "canceled") status = "cancelled";
  else if (session.status === "complete" && session.payment_status === "unpaid") {
    // Métodos diferidos: completo sin pago = aún pendiente salvo error informado.
    status = pi?.last_payment_error ? "failed" : "pending";
  } else status = "pending";
  return {
    providerPaymentId: piId,
    status,
    amount: session.amount_total ?? -1,
    currency: session.currency.toUpperCase(),
    externalReference: session.client_reference_id ?? "",
    ...(session.payment_method_types?.[0] ? { method: session.payment_method_types[0] } : {}),
    ...(pi?.last_payment_error?.code ? { failureCode: pi.last_payment_error.code } : {}),
  };
}

/** Verificación de `Stripe-Signature: t=…,v1=…` (HMAC-SHA256 de `${t}.${body}`). */
export function verifyStripeSignature(input: {
  secret: string;
  header: string | null;
  rawBody: string;
  now: Date;
  toleranceSeconds?: number;
}): { ok: true; signedAt: Date } | { ok: false; reason: "bad_signature" | "stale" | "malformed" } {
  if (!input.header || input.header.length > 2048) return { ok: false, reason: "malformed" };
  const parts = input.header
    .split(",")
    .map((p) => p.trim().split("=") as [string, string | undefined]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v!);
  if (!t || !/^\d{1,12}$/.test(t) || signatures.length === 0)
    return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", input.secret).update(`${t}.${input.rawBody}`).digest("hex");
  if (!signatures.some((s) => /^[0-9a-f]{64}$/.test(s) && constantTimeEqual(s, expected))) {
    return { ok: false, reason: "bad_signature" };
  }
  const signedAt = Number(t);
  if (Math.abs(input.now.getTime() / 1000 - signedAt) > (input.toleranceSeconds ?? 300)) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, signedAt: new Date(signedAt * 1000) };
}

/** Tipos de evento que mueven el estado de un intento (el resto se registra y se ignora). */
export const STRIPE_PAYMENT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export interface StripeProvider extends PaymentProvider {
  api: StripeApi;
  fetchSession(account: PaymentAccountCredentials, sessionId: string): Promise<NormalizedPayment>;
  refund(input: {
    account: PaymentAccountCredentials;
    providerPaymentId: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<{ providerRefundId: string; status: "succeeded" | "pending" | "failed" }>;
}

export function createStripeProvider(cfg: StripeConfig): StripeProvider {
  const api = new StripeApi(cfg);
  return {
    key: "stripe",
    api,
    capabilities: {
      redirectCheckout: true,
      embeddedCheckout: false,
      delayedMethods: true,
      refunds: true,
      partialRefunds: true,
      providerSideExpiration: true,
    },
    async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
      const account = stripeAccountId(input.account);
      const expiresAt = Math.max(
        Math.floor(input.expiresAt.getTime() / 1000),
        Math.floor(Date.now() / 1000) + MIN_SESSION_SECONDS,
      );
      const session = await api.request<StripeSession>("POST", "/v1/checkout/sessions", {
        account,
        idempotencyKey: input.idempotencyKey,
        params: {
          mode: "payment",
          client_reference_id: input.payment.id,
          customer_email: input.buyer.email,
          // Un solo concepto por el total calculado por la base: Stripe cobra
          // exactamente lo mismo (envío, impuestos y descuentos ya incluidos).
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.payment.currency.toLowerCase(),
                unit_amount: input.payment.amount,
                product_data: { name: `Pedido ${input.order.displayNumber}` },
              },
            },
          ],
          success_url: input.returnUrls.success,
          cancel_url: input.returnUrls.failure,
          expires_at: expiresAt,
          metadata: { payment_id: input.payment.id, order_id: input.order.id },
          payment_intent_data: {
            metadata: { payment_id: input.payment.id, order_id: input.order.id },
          },
        },
      });
      if (!session.url) throw new AppError("provider_error");
      return { providerCheckoutId: session.id, redirectUrl: session.url };
    },
    async verifyWebhook({ headers, rawBody, now }): Promise<WebhookVerification> {
      const check = verifyStripeSignature({
        secret: cfg.webhookSecret,
        header: headers.get("stripe-signature"),
        rawBody,
        now,
        ...(cfg.toleranceSeconds ? { toleranceSeconds: cfg.toleranceSeconds } : {}),
      });
      if (!check.ok) return check;
      let event: {
        id?: unknown;
        type?: unknown;
        account?: unknown;
        data?: { object?: Record<string, unknown> };
      };
      try {
        event = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (typeof event.id !== "string" || typeof event.type !== "string")
        return { ok: false, reason: "malformed" };
      const object = event.data?.object ?? {};
      return {
        ok: true,
        eventId: event.id,
        type: event.type,
        signedAt: check.signedAt,
        ...(typeof event.account === "string" ? { account: event.account } : {}),
        ...(typeof object.id === "string" && object.object === "checkout.session"
          ? { checkoutId: object.id }
          : {}),
        ...(typeof object.client_reference_id === "string"
          ? { reference: object.client_reference_id }
          : {}),
      };
    },
    fetchSession(account, sessionId) {
      return api.retrieveSession(stripeAccountId(account), sessionId).then(normalizeSession);
    },
    async refund(input) {
      const r = await api.request<{ id: string; status: string }>("POST", "/v1/refunds", {
        account: stripeAccountId(input.account),
        idempotencyKey: input.idempotencyKey,
        params: { payment_intent: input.providerPaymentId, amount: input.amount },
      });
      const status =
        r.status === "succeeded"
          ? "succeeded"
          : r.status === "failed" || r.status === "canceled"
            ? "failed"
            : "pending";
      return { providerRefundId: r.id, status };
    },
  };
}
