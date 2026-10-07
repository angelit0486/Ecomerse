import type { Sql } from "@/server/db/role-clients";
import type { Logger } from "@/server/observability/logger";

import type { NormalizedPayment, PaymentAccountCredentials } from "./provider";
import { syncStripeAccount } from "./connect";
import { STRIPE_PAYMENT_EVENTS, type StripeProvider } from "./stripe";

/**
 * Webhook de pagos (GATE0 §18.4, orden normativo) para Stripe Connect:
 * 1. firma y marca de tiempo (±5 min) con el secreto del endpoint Connect;
 * 2. cuenta conectada del evento → cuenta de pago de la tienda (inexistente: 404 genérico);
 * 3. registro deduplicado del evento (ya procesado: 200);
 * 4. RE-CONSULTA al proveedor (fuente de verdad);
 * 5-6. system.apply_payment_status valida referencia, monto y moneda y aplica.
 * `account.updated` sincroniza el estado de la cuenta conectada (F7-T06) y
 * `account.application.deauthorized` la deja en error (Gate F7).
 * Responde rápido; un error interno devuelve 500 para que el proveedor reintente.
 */
export interface WebhookResult {
  status: number;
  body: { received: boolean; outcome?: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface PaymentRef {
  id: string;
  order_id: string;
  store_id: string;
  status: string;
  provider_checkout_id: string | null;
  account: {
    id: string;
    provider: string;
    mode: "test" | "live";
    public_config: Record<string, unknown>;
  };
}

function credentials(account: PaymentRef["account"]): PaymentAccountCredentials {
  return {
    id: account.id,
    provider: account.provider as PaymentAccountCredentials["provider"],
    mode: account.mode,
    publicConfig: account.public_config,
  };
}

/** Solo lo necesario del evento: nunca datos de tarjeta ni del comprador (§18.3). */
function sanitize(rawBody: string): Record<string, unknown> {
  const event = JSON.parse(rawBody) as {
    id: string;
    type: string;
    account?: string;
    created?: number;
    data?: { object?: Record<string, unknown> };
  };
  const o = event.data?.object ?? {};
  const pick = (k: string) =>
    typeof o[k] === "string" || typeof o[k] === "number" ? o[k] : undefined;
  return {
    id: event.id,
    type: event.type,
    account: event.account,
    created: event.created,
    object: {
      id: pick("id"),
      object: pick("object"),
      status: pick("status"),
      payment_status: pick("payment_status"),
      amount_total: pick("amount_total"),
      currency: pick("currency"),
      client_reference_id: pick("client_reference_id"),
      payment_intent: typeof o.payment_intent === "string" ? o.payment_intent : undefined,
    },
  };
}

export async function handleStripeWebhook(deps: {
  db: Sql;
  provider: StripeProvider;
  headers: Headers;
  rawBody: string;
  now: Date;
  log: Logger;
  /** Producción: solo eventos `livemode` (un endpoint live también recibe los de prueba). */
  requireLivemode?: boolean;
}): Promise<WebhookResult> {
  const { db, provider, log } = deps;
  if (deps.rawBody.length > 262_144) return { status: 413, body: { received: false } };
  const verified = await provider.verifyWebhook({
    account: { id: "", provider: "stripe", mode: "test", publicConfig: {} },
    headers: deps.headers,
    rawBody: deps.rawBody,
    now: deps.now,
  });
  if (!verified.ok) {
    // Con límite de frecuencia: un tercero sin firma no puede inflar la tabla.
    await db`select system.record_webhook_rejection(${`payment.webhook_${verified.reason}`}, 'stripe')`;
    return { status: verified.reason === "malformed" ? 400 : 401, body: { received: false } };
  }
  // Eventos de la propia plataforma (sin cuenta conectada): nada que aplicar.
  if (!verified.account) return { status: 200, body: { received: true, outcome: "ignored" } };
  if (deps.requireLivemode && !verified.livemode) {
    return { status: 200, body: { received: true, outcome: "ignored" } };
  }

  const [account] = await db<{ id: string; store_id: string; status: string }[]>`
    select * from system.payment_account_for_webhook('stripe', ${verified.account})`;
  if (!account) {
    await db`select system.record_webhook_rejection('payment.webhook_unknown_account', 'stripe')`;
    return { status: 404, body: { received: false } };
  }

  const [rec] = await db<{ r: { id: string; processed: boolean } }[]>`
    select system.record_payment_event(${account.id}, ${verified.eventId}, ${verified.type},
                                       ${verified.signedAt}, ${db.json(sanitize(deps.rawBody) as never)}) as r`;
  const event = rec!.r;
  if (event.processed) return { status: 200, body: { received: true, outcome: "duplicate" } };

  try {
    if (verified.type === "account.application.deauthorized") {
      // La tienda retiró el acceso de la plataforma en Stripe: deja de ofrecer tarjeta.
      await db`select system.stripe_mark_deauthorized(${verified.account})`;
      await db`select system.finish_payment_event(${event.id}, null)`;
      return { status: 200, body: { received: true, outcome: "account_deauthorized" } };
    }
    if (verified.type === "account.updated") {
      // Estado de la cuenta conectada: se re-consulta a Stripe (fuente de verdad).
      await syncStripeAccount({ db, api: provider.api }, verified.account);
      await db`select system.finish_payment_event(${event.id}, null)`;
      return { status: 200, body: { received: true, outcome: "account_synced" } };
    }
    if (!STRIPE_PAYMENT_EVENTS.has(verified.type) || !verified.checkoutId) {
      await db`select system.finish_payment_event(${event.id}, null)`;
      return { status: 200, body: { received: true, outcome: "ignored" } };
    }
    const reference =
      verified.reference && UUID_RE.test(verified.reference) ? verified.reference : null;
    const [found] = await db<{ p: PaymentRef | null }[]>`
      select system.payment_for_provider_ref(${account.id}, ${verified.checkoutId}, ${reference}) as p`;
    const payment = found?.p;
    if (!payment) {
      // Sesión que no es de esta cuenta o de un intento desconocido: se registra y no se aplica.
      await db`select system.finish_payment_event(${event.id}, 'payment_not_found')`;
      await db`select system.record_security_event('payment.webhook_unknown_payment', 'warning', null,
                                                  ${account.store_id}, null, null, null, ${db.json({ event: verified.eventId })})`;
      return { status: 200, body: { received: true, outcome: "unknown_payment" } };
    }
    const normalized: NormalizedPayment = await provider.fetchSession(
      credentials(payment.account),
      verified.checkoutId,
    );
    const [applied] = await db<{ r: { outcome: string } }[]>`
      select system.apply_payment_status(${payment.id}, ${db.json({
        status: normalized.status,
        amount: normalized.amount,
        currency: normalized.currency,
        provider_payment_id: normalized.providerPaymentId,
        external_reference: normalized.externalReference,
        method: normalized.method ?? null,
        failure_code: normalized.failureCode ?? null,
      })}) as r`;
    await db`select system.finish_payment_event(${event.id}, null)`;
    return { status: 200, body: { received: true, outcome: applied!.r.outcome } };
  } catch (error) {
    log.error("payment.webhook_failed", { event_id: verified.eventId, err: error });
    await db`select system.finish_payment_event(${event.id}, 'processing_failed')`.catch(
      () => undefined,
    );
    return { status: 500, body: { received: false } };
  }
}

/** Reconciliación (§18.5): re-consulta intentos abiertos y aplica su estado. */
export async function reconcilePayments(deps: {
  db: Sql;
  provider: StripeProvider;
  log: Logger;
}): Promise<number> {
  const rows = await deps.db<
    { payment_id: string; account: PaymentRef["account"]; provider_checkout_id: string }[]
  >`
    select * from system.payments_to_reconcile(100)`;
  let applied = 0;
  for (const row of rows) {
    try {
      const n = await deps.provider.fetchSession(
        credentials(row.account),
        row.provider_checkout_id,
      );
      await deps.db`select system.apply_payment_status(${row.payment_id}, ${deps.db.json({
        status: n.status,
        amount: n.amount,
        currency: n.currency,
        provider_payment_id: n.providerPaymentId,
        external_reference: n.externalReference,
        method: n.method ?? null,
        failure_code: n.failureCode ?? null,
      })})`;
      applied += 1;
    } catch (error) {
      deps.log.warn("payment.reconcile_failed", { payment_id: row.payment_id, err: error });
    }
  }
  return applied;
}
