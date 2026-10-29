import type { Sql } from "@/server/db/role-clients";
import type { Logger } from "@/server/observability/logger";

import type { MercadoPagoProvider } from "./mercadopago";
import type { NormalizedPayment } from "./provider";
import type { WebhookResult } from "./webhook";

/**
 * Webhook de Mercado Pago (GATE0 §18.4, orden normativo; ADR-028):
 * 1. firma `x-signature` (±5 min) con la clave secreta de la plataforma;
 * 2. collector del evento (`user_id`) → cuenta de pago de la tienda (inexistente: 404 genérico);
 * 3. registro deduplicado del evento (ya procesado: 200);
 * 4. RE-CONSULTA del cobro a Mercado Pago (fuente de verdad), del mismo collector;
 * 5-6. system.apply_mercadopago_payment valida referencia, monto y moneda y aplica.
 * El retorno del comprador a la tienda nunca confirma nada.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Solo lo necesario del evento: nunca datos del comprador ni del medio de pago (§18.3). */
function sanitize(rawBody: string): Record<string, unknown> {
  const e = JSON.parse(rawBody) as Record<string, unknown> & { data?: { id?: unknown } };
  const pick = (v: unknown) => (typeof v === "string" || typeof v === "number" ? v : undefined);
  return {
    id: pick(e.id),
    type: pick(e.type),
    action: pick(e.action),
    user_id: pick(e.user_id),
    live_mode: typeof e.live_mode === "boolean" ? e.live_mode : undefined,
    date_created: pick(e.date_created),
    data: { id: pick(e.data?.id) },
  };
}

function toRpc(n: NormalizedPayment) {
  return {
    status: n.status,
    amount: n.amount,
    currency: n.currency,
    provider_payment_id: n.providerPaymentId,
    external_reference: n.externalReference,
    method: n.method ?? null,
    failure_code: n.failureCode ?? null,
    reversal: n.reversal ?? null,
  };
}

export async function handleMercadoPagoWebhook(deps: {
  db: Sql;
  provider: MercadoPagoProvider;
  url: URL;
  headers: Headers;
  rawBody: string;
  now: Date;
  log: Logger;
  /** Producción: solo eventos `live_mode` (los de prueba se ignoran). */
  requireLivemode?: boolean;
}): Promise<WebhookResult> {
  const { db, provider, log } = deps;
  if (deps.rawBody.length > 262_144) return { status: 413, body: { received: false } };
  const verified = await provider.verifyWebhook({
    account: { id: "", provider: "mercadopago", mode: "test", publicConfig: {} },
    headers: deps.headers,
    rawBody: deps.rawBody,
    now: deps.now,
  });
  // La firma cubre el `data.id` de la URL: si la URL trae otro, el cuerpo no es el firmado.
  const queryId = deps.url.searchParams.get("data.id");
  const reason = !verified.ok
    ? verified.reason
    : queryId && verified.providerPaymentId && queryId !== verified.providerPaymentId
      ? "malformed"
      : null;
  if (reason || !verified.ok) {
    const r = reason ?? "malformed";
    await db`select system.record_webhook_rejection(${`payment.webhook_${r}`}, 'mercadopago')`;
    return { status: r === "malformed" ? 400 : 401, body: { received: false } };
  }
  if (!verified.account) return { status: 200, body: { received: true, outcome: "ignored" } };
  if (deps.requireLivemode && !verified.livemode) {
    return { status: 200, body: { received: true, outcome: "ignored" } };
  }

  const [account] = await db<{ id: string; store_id: string; status: string; mode: string }[]>`
    select * from system.payment_account_for_webhook('mercadopago', ${verified.account})`;
  if (!account) {
    await db`select system.record_webhook_rejection('payment.webhook_unknown_account', 'mercadopago')`;
    return { status: 404, body: { received: false } };
  }

  const [rec] = await db<{ r: { id: string; processed: boolean } }[]>`
    select system.record_payment_event(${account.id}, ${verified.eventId}, ${verified.type},
                                       ${verified.signedAt}, ${db.json(sanitize(deps.rawBody) as never)}) as r`;
  const event = rec!.r;
  if (event.processed) return { status: 200, body: { received: true, outcome: "duplicate" } };

  try {
    if (!verified.providerPaymentId) {
      await db`select system.finish_payment_event(${event.id}, null)`;
      return { status: 200, body: { received: true, outcome: "ignored" } };
    }
    // Con la llave de ESA cuenta (la del comercio, ADR-041): otra cuenta no ve el cobro.
    const payment = await provider.fetchPayment(verified.providerPaymentId, {
      id: account.id,
      provider: "mercadopago",
      mode: account.mode === "live" ? "live" : "test",
      publicConfig: { mp_user_id: verified.account },
    });
    const reference = UUID_RE.test(payment.externalReference) ? payment.externalReference : null;
    const [found] = await db<{ p: { id: string } | null }[]>`
      select system.payment_for_provider_ref(${account.id}, null, ${reference}) as p`;
    if (!found?.p || (payment.collectorId && payment.collectorId !== verified.account)) {
      // Cobro de otra cuenta o de un intento desconocido: se registra y no se aplica.
      await db`select system.finish_payment_event(${event.id}, 'payment_not_found')`;
      await db`select system.record_security_event('payment.webhook_unknown_payment', 'warning', null,
                                                  ${account.store_id}, null, null, null, ${db.json({ event: verified.eventId })})`;
      return { status: 200, body: { received: true, outcome: "unknown_payment" } };
    }
    const [applied] = await db<{ r: { outcome: string } }[]>`
      select system.apply_mercadopago_payment(${found.p.id}, ${db.json(toRpc(payment))}) as r`;
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

/** Reconciliación (§18.5) de los intentos de Mercado Pago: búsqueda por referencia. */
export async function reconcileMercadoPagoPayments(deps: {
  db: Sql;
  provider: MercadoPagoProvider;
  log: Logger;
}): Promise<number> {
  const rows = await deps.db<
    {
      payment_id: string;
      account: {
        id: string;
        provider: string;
        mode: "test" | "live";
        public_config: Record<string, unknown>;
      };
    }[]
  >`
    select payment_id, account from system.payments_to_reconcile(100)`;
  let applied = 0;
  for (const row of rows) {
    if (row.account.provider !== "mercadopago") continue;
    try {
      const n = await deps.provider.fetchByReference(row.payment_id, {
        id: row.account.id,
        provider: "mercadopago",
        mode: row.account.mode,
        publicConfig: row.account.public_config,
      });
      if (!n) continue; // Aún sin cobro: el comprador no ha pagado.
      await deps.db`select system.apply_mercadopago_payment(${row.payment_id}, ${deps.db.json(toRpc(n))})`;
      applied += 1;
    } catch (error) {
      deps.log.warn("payment.reconcile_failed", { payment_id: row.payment_id, err: error });
    }
  }
  return applied;
}
