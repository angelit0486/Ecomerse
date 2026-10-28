import { createHmac } from "node:crypto";

import { AppError } from "@/server/errors";
import { UPSTREAM_REQUEST_ID_HEADER } from "@/server/observability/request-id";
import { constantTimeEqual } from "@/server/security/hmac";

import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedPayment,
  PaymentAccountCredentials,
  PaymentProvider,
  WebhookVerification,
} from "./provider";
import { ProviderHttpError } from "./provider";

/**
 * Mercado Pago Checkout Pro (ADR-028). La plataforma opera con un access token;
 * la cuenta de la tienda guarda solo su `mp_user_id` (collector). Sin SDK: REST
 * con fetch, tiempo máximo por llamada y `X-Idempotency-Key` en cada POST.
 * El retorno del comprador nunca confirma un pago: solo el webhook firmado (con
 * re-consulta del cobro) o la reconciliación (§18.4-18.5).
 * Detalles verificados contra la documentación pública de Mercado Pago; la prueba
 * real con credenciales de prueba queda pendiente del propietario.
 */
export interface MercadoPagoConfig {
  /** Token de la plataforma: cuentas conectadas antes de ADR-041 y validar la propia. */
  accessToken: string;
  /**
   * ADR-041: token de la cuenta del comercio (OAuth), descifrado y renovado por el
   * servidor. Sin él (o si la cuenta no tiene llaves propias) se usa `accessToken`.
   */
  tokenFor?: (account: PaymentAccountCredentials) => Promise<string>;
  webhookSecret: string;
  apiBase?: string;
  /** Tolerancia de la firma del webhook (§18.4: ±5 min). */
  toleranceSeconds?: number;
  fetchImpl?: typeof fetch;
}

export class MercadoPagoHttpError extends ProviderHttpError {
  constructor(httpStatus: number, path: string, method: string) {
    super(httpStatus, "mercadopago", path, method);
  }
}

const NUMERIC_ID_RE = /^[0-9]{1,20}$/;
const PREFERENCE_ID_RE = /^[A-Za-z0-9-]{8,200}$/;
/** Solo el checkout alojado por Mercado Pago (nunca otra URL aunque la API la devolviera). */
const CHECKOUT_URL_RE = /^https:\/\/([a-z0-9-]+\.)?mercadopago\.com(\.[a-z]{2})?\//;

export interface MercadoPagoPayment {
  id: number | string;
  status: string;
  status_detail?: string | null;
  transaction_amount: number;
  currency_id: string;
  external_reference: string | null;
  payment_type_id?: string | null;
  collector_id?: number | string | null;
  date_created?: string | null;
}

/** Centavos → decimal con 2 cifras (la API de Mercado Pago usa montos decimales). */
export function toDecimal(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new AppError("validation_failed");
  return Number((cents / 100).toFixed(2));
}

/** Decimal → centavos; un monto con más de 2 decimales no es válido (-1 → discrepancia). */
export function toCents(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return -1;
  const cents = Math.round(amount * 100);
  return Math.abs(amount * 100 - cents) < 1e-6 ? cents : -1;
}

/** Estado del cobro de Mercado Pago → estado normalizado (§18.2). */
export function normalizeMercadoPagoStatus(status: string): NormalizedPayment["status"] {
  switch (status) {
    case "approved":
      return "succeeded";
    case "authorized":
      return "authorized";
    case "rejected":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      // pending, in_process, in_mediation y cualquier estado nuevo: sin cobro confirmado.
      return "pending";
  }
}

export function normalizeMercadoPagoPayment(p: MercadoPagoPayment): NormalizedPayment {
  const status = normalizeMercadoPagoStatus(p.status);
  return {
    providerPaymentId: String(p.id),
    status,
    amount: toCents(p.transaction_amount),
    currency: String(p.currency_id ?? "").toUpperCase(),
    externalReference: p.external_reference ?? "",
    ...(p.payment_type_id ? { method: String(p.payment_type_id).slice(0, 50) } : {}),
    ...(status === "failed" && p.status_detail
      ? { failureCode: String(p.status_detail).slice(0, 100) }
      : {}),
  };
}

/**
 * Firma de Mercado Pago (`x-signature: ts=…,v1=…`): HMAC-SHA256 en hexadecimal de
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con la clave secreta. Las
 * partes ausentes se omiten; un `data.id` alfanumérico va en minúsculas.
 */
export function verifyMercadoPagoSignature(input: {
  secret: string;
  header: string | null;
  requestId: string | null;
  dataId: string | null;
  now: Date;
  toleranceSeconds?: number;
}): { ok: true; signedAt: Date } | { ok: false; reason: "bad_signature" | "stale" | "malformed" } {
  if (!input.header || input.header.length > 1024) return { ok: false, reason: "malformed" };
  const parts = input.header.split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  });
  const ts = parts.find(([k]) => k === "ts")?.[1];
  const v1 = parts.find(([k]) => k === "v1")?.[1];
  if (!ts || !/^\d{1,15}$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) {
    return { ok: false, reason: "malformed" };
  }
  if (input.requestId && input.requestId.length > 200) return { ok: false, reason: "malformed" };
  const dataId = input.dataId
    ? /^[A-Za-z0-9]+$/.test(input.dataId)
      ? input.dataId.toLowerCase()
      : input.dataId
    : null;
  const manifest =
    (dataId ? `id:${dataId};` : "") +
    (input.requestId ? `request-id:${input.requestId};` : "") +
    `ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  if (!constantTimeEqual(v1, expected)) return { ok: false, reason: "bad_signature" };
  // La documentación muestra `ts` en segundos; algunos envíos lo traen en milisegundos.
  const ms = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs(input.now.getTime() - ms) > (input.toleranceSeconds ?? 300) * 1000) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, signedAt: new Date(ms) };
}

export function mercadoPagoUserId(account: PaymentAccountCredentials): string {
  const id = account.publicConfig.mp_user_id;
  if (typeof id !== "string" || !NUMERIC_ID_RE.test(id)) {
    throw new AppError("provider_error", "La cuenta de Mercado Pago no está conectada.");
  }
  return id;
}

export class MercadoPagoApi {
  constructor(private readonly cfg: MercadoPagoConfig) {}

  async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { body?: unknown; idempotencyKey?: string; token?: string } = {},
  ): Promise<T> {
    const base = this.cfg.apiBase ?? "https://api.mercadopago.com";
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.token ?? this.cfg.accessToken}`,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["x-idempotency-key"] = options.idempotencyKey;
    let response: Response;
    try {
      response = await (this.cfg.fetchImpl ?? fetch)(`${base}${path}`, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new AppError("provider_error", undefined, { cause: error });
    }
    // El cuerpo de error nunca llega al cliente (puede traer datos internos).
    if (!response.ok) throw new MercadoPagoHttpError(response.status, path, method);
    return (await response.json()) as T;
  }

  /** Cuenta dueña del access token (al conectar la tienda). */
  async me(token?: string): Promise<{ id: string; siteId: string }> {
    const u = await this.request<{ id: number | string; site_id?: string }>(
      "GET",
      "/users/me",
      token ? { token } : {},
    );
    const id = String(u.id);
    if (!NUMERIC_ID_RE.test(id)) throw new AppError("provider_error");
    return { id, siteId: String(u.site_id ?? "") };
  }

  getPayment(paymentId: string, token?: string): Promise<MercadoPagoPayment> {
    if (!NUMERIC_ID_RE.test(paymentId)) throw new AppError("validation_failed");
    return this.request("GET", `/v1/payments/${paymentId}`, token ? { token } : {});
  }

  /** Cobros de un intento (external_reference = payments.id), el más reciente primero. */
  async searchByReference(reference: string, token?: string): Promise<MercadoPagoPayment[]> {
    if (!/^[0-9a-f-]{36}$/.test(reference)) throw new AppError("validation_failed");
    const r = await this.request<{ results?: MercadoPagoPayment[] }>(
      "GET",
      `/v1/payments/search?external_reference=${reference}&sort=date_created&criteria=desc`,
      token ? { token } : {},
    );
    return Array.isArray(r.results) ? r.results : [];
  }

  getRefund(
    paymentId: string,
    refundId: string,
    token?: string,
  ): Promise<{ id: number | string; status: string }> {
    if (!NUMERIC_ID_RE.test(paymentId) || !NUMERIC_ID_RE.test(refundId)) {
      throw new AppError("validation_failed");
    }
    return this.request(
      "GET",
      `/v1/payments/${paymentId}/refunds/${refundId}`,
      token ? { token } : {},
    );
  }
}

/**
 * De varios cobros de un mismo intento, el que manda: uno aprobado (o ya
 * reembolsado) si existe; si no, el más reciente.
 */
export function pickPayment(payments: MercadoPagoPayment[]): MercadoPagoPayment | null {
  const paid = payments.find((p) => ["approved", "refunded", "charged_back"].includes(p.status));
  return paid ?? payments[0] ?? null;
}

export interface MercadoPagoProvider extends PaymentProvider {
  api: MercadoPagoApi;
  /** Re-consulta con la llave de la cuenta del cobro (la del comercio con ADR-041). */
  fetchPayment(
    paymentId: string,
    account: PaymentAccountCredentials,
  ): Promise<NormalizedPayment & { collectorId: string | null }>;
  /** Estado de un intento por su referencia (reconciliación); null si aún no hay cobro. */
  fetchByReference(
    reference: string,
    account: PaymentAccountCredentials,
  ): Promise<NormalizedPayment | null>;
  refund(input: {
    account: PaymentAccountCredentials;
    providerPaymentId: string;
    amount: number;
    idempotencyKey: string;
    providerRefundId?: string | null;
  }): Promise<{ providerRefundId: string; status: "succeeded" | "pending" | "failed" }>;
}

function refundStatus(status: string): "succeeded" | "failed" | "pending" {
  if (status === "approved") return "succeeded";
  return status === "rejected" || status === "cancelled" ? "failed" : "pending";
}

export function createMercadoPagoProvider(cfg: MercadoPagoConfig): MercadoPagoProvider {
  const api = new MercadoPagoApi(cfg);
  const tokenOf = (account: PaymentAccountCredentials) =>
    cfg.tokenFor ? cfg.tokenFor(account) : Promise.resolve(cfg.accessToken);
  return {
    key: "mercadopago",
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
      mercadoPagoUserId(input.account);
      if (input.payment.currency.toUpperCase() !== "MXN") {
        throw new AppError("provider_error", "Mercado Pago solo cobra en pesos mexicanos.");
      }
      const https = input.returnUrls.success.startsWith("https://");
      const pref = await api.request<{
        id: string;
        init_point?: string;
        sandbox_init_point?: string;
      }>("POST", "/checkout/preferences", {
        // La preferencia se crea en la cuenta del comercio: el cobro llega a ella.
        token: await tokenOf(input.account),
        idempotencyKey: input.idempotencyKey,
        body: {
          // Un solo concepto por el total calculado por la base: Mercado Pago cobra
          // exactamente lo mismo (envío, impuestos y descuentos ya incluidos).
          items: [
            {
              id: input.order.id,
              title: `Pedido ${input.order.displayNumber}`,
              quantity: 1,
              unit_price: toDecimal(input.payment.amount),
              currency_id: "MXN",
            },
          ],
          payer: {
            email: input.buyer.email,
            ...(input.buyer.name ? { name: input.buyer.name } : {}),
          },
          external_reference: input.payment.id,
          back_urls: input.returnUrls,
          // Mercado Pago solo regresa automáticamente al comprador a direcciones https.
          ...(https ? { auto_return: "approved" } : {}),
          expires: true,
          expiration_date_to: input.expiresAt.toISOString(),
          metadata: { payment_id: input.payment.id, order_id: input.order.id },
        },
      });
      const url =
        input.account.mode === "test"
          ? (pref.sandbox_init_point ?? pref.init_point)
          : pref.init_point;
      if (!pref.id || !PREFERENCE_ID_RE.test(pref.id) || !url || !CHECKOUT_URL_RE.test(url)) {
        throw new AppError("provider_error");
      }
      return { providerCheckoutId: pref.id, redirectUrl: url };
    },
    async verifyWebhook({ headers, rawBody, now }): Promise<WebhookVerification> {
      let body: {
        id?: unknown;
        type?: unknown;
        action?: unknown;
        user_id?: unknown;
        live_mode?: unknown;
        data?: { id?: unknown };
      };
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (!body || typeof body !== "object") return { ok: false, reason: "malformed" };
      const dataId =
        typeof body.data?.id === "string" || typeof body.data?.id === "number"
          ? String(body.data.id)
          : null;
      const check = verifyMercadoPagoSignature({
        secret: cfg.webhookSecret,
        header: headers.get("x-signature"),
        // El proxy reemplaza x-request-id; el original firmado llega aparte.
        requestId: headers.get(UPSTREAM_REQUEST_ID_HEADER),
        dataId,
        now,
        ...(cfg.toleranceSeconds ? { toleranceSeconds: cfg.toleranceSeconds } : {}),
      });
      if (!check.ok) return check;
      const type = typeof body.type === "string" ? body.type : null;
      const eventId =
        typeof body.id === "string" || typeof body.id === "number"
          ? String(body.id)
          : `${String(body.action ?? type)}:${dataId}:${check.signedAt.getTime()}`;
      if (!type || eventId.length > 255) return { ok: false, reason: "malformed" };
      const account =
        typeof body.user_id === "string" || typeof body.user_id === "number"
          ? String(body.user_id)
          : undefined;
      return {
        ok: true,
        eventId,
        type: typeof body.action === "string" ? body.action.slice(0, 100) : type.slice(0, 100),
        signedAt: check.signedAt,
        livemode: body.live_mode === true,
        ...(account && NUMERIC_ID_RE.test(account) ? { account } : {}),
        ...(type === "payment" && dataId && NUMERIC_ID_RE.test(dataId)
          ? { providerPaymentId: dataId }
          : {}),
      };
    },
    async fetchPayment(paymentId, account) {
      const p = await api.getPayment(paymentId, await tokenOf(account));
      return {
        ...normalizeMercadoPagoPayment(p),
        collectorId: p.collector_id == null ? null : String(p.collector_id),
      };
    },
    async fetchByReference(reference, account) {
      const p = pickPayment(await api.searchByReference(reference, await tokenOf(account)));
      return p ? normalizeMercadoPagoPayment(p) : null;
    },
    async refund(input) {
      mercadoPagoUserId(input.account);
      if (!NUMERIC_ID_RE.test(input.providerPaymentId)) throw new AppError("validation_failed");
      const token = await tokenOf(input.account);
      // Ya creado: se consulta su estado; repetir el POST devolvería la primera respuesta.
      const r = input.providerRefundId
        ? await api.getRefund(input.providerPaymentId, input.providerRefundId, token)
        : await api.request<{ id: number | string; status: string }>(
            "POST",
            `/v1/payments/${input.providerPaymentId}/refunds`,
            {
              token,
              idempotencyKey: input.idempotencyKey,
              body: { amount: toDecimal(input.amount) },
            },
          );
      return { providerRefundId: String(r.id), status: refundStatus(r.status) };
    },
  };
}
