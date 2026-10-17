import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "@/server/observability/logger";
import { createMercadoPagoProvider } from "@/server/payments/mercadopago";
import {
  handleMercadoPagoWebhook,
  reconcileMercadoPagoPayments,
} from "@/server/payments/mercadopago-webhook";

/**
 * Webhook de Mercado Pago (GATE0 §18.4, §34.4; ADR-028) contra PostgreSQL real con
 * el rol system_worker; la API de Mercado Pago se simula (re-consulta = fuente de verdad).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "mpintegration0000000000";
const COLLECTOR = String(randomInt(100_000_000, 999_999_999));

/** Cobros que devuelve la API simulada, por id. */
const payments = new Map<string, Record<string, unknown>>();
const fetchImpl = (async (url: string) => {
  const u = new URL(url);
  if (u.pathname === "/v1/payments/search") {
    const ref = u.searchParams.get("external_reference");
    const results = [...payments.values()].filter((p) => p.external_reference === ref).reverse();
    return new Response(JSON.stringify({ results }));
  }
  const id = u.pathname.split("/").pop()!;
  const p = payments.get(id);
  return new Response(JSON.stringify(p ?? { message: "not_found" }), { status: p ? 200 : 404 });
}) as unknown as typeof fetch;
const provider = createMercadoPagoProvider({
  accessToken: "TEST-0000000000000000-000000-integration",
  webhookSecret: SECRET,
  apiBase: "https://mp.test",
  fetchImpl,
});

let storeId: string;
let accountId: string;
let variantId: string;

async function order(qty = 1): Promise<{ orderId: string; paymentId: string; amount: number }> {
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, ${qty})`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token},
      ${admin.json({ email: `c-${randomBytes(3).toString("hex")}@example.test`, customer_name: "C", payment_account_id: accountId })},
      ${10000 * qty}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  await admin`select storefront.record_checkout_result(${storeId}, ${o!.r.payment.id}, true,
                                                       ${`${COLLECTOR}-${randomBytes(6).toString("hex")}`})`;
  return { orderId: o!.r.order_id, paymentId: o!.r.payment.id, amount: 10000 * qty };
}

/** Un cobro en la API simulada para el intento. */
function charge(paymentId: string, status: string, extra: Record<string, unknown> = {}): string {
  const id = String(randomInt(1_000_000, 9_999_999_999));
  payments.set(id, {
    id: Number(id),
    status,
    status_detail: status === "rejected" ? "cc_rejected_other_reason" : "accredited",
    transaction_amount: 100,
    currency_id: "MXN",
    external_reference: paymentId,
    payment_type_id: "credit_card",
    collector_id: Number(COLLECTOR),
    ...extra,
  });
  return id;
}

function deliver(
  dataId: string,
  opts: {
    secret?: string;
    at?: number;
    user?: string;
    eventId?: string;
    queryId?: string;
    requireLivemode?: boolean;
  } = {},
) {
  const ts = String(opts.at ?? Math.floor(Date.now() / 1000));
  const requestId = randomBytes(8).toString("hex");
  const sig = createHmac("sha256", opts.secret ?? SECRET)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  const body = JSON.stringify({
    id: opts.eventId ?? randomInt(1_000_000, 9_999_999_999),
    type: "payment",
    action: "payment.updated",
    user_id: opts.user ?? COLLECTOR,
    live_mode: false,
    data: { id: dataId },
  });
  return handleMercadoPagoWebhook({
    db: worker,
    provider,
    url: new URL(
      `https://app.test/api/webhooks/payments/mercadopago?data.id=${opts.queryId ?? dataId}&type=payment`,
    ),
    headers: new Headers({ "x-signature": `ts=${ts},v1=${sig}`, "x-request-id": requestId }),
    rawBody: body,
    now: new Date(),
    log,
    ...(opts.requireLivemode ? { requireLivemode: true } : {}),
  });
}

async function state(orderId: string) {
  const [o] = await admin<
    { status: string; payment_status: string; needs_attention: boolean; paid_total: string }[]
  >`
    select status, payment_status, needs_attention, paid_total from public.orders where id = ${orderId}`;
  return o!;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('mp_plan', 'mp_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org mp', ${`org-mp-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at,
                               prices_include_tax, tax_rate_bps)
    values (${org!.id}, 'Tienda mp', ${`mp-${run}`}, 'MXN', 'MX', 'America/Mazatlan', 'active', now(), true, 0)
    returning id`;
  storeId = s!.id;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Creatina', 'creatina', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`MP-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await worker`select system.mercadopago_attach_account(${storeId}::uuid, ${COLLECTOR}, 'test')`;
  const [a] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${storeId} and provider = 'mercadopago'`;
  accountId = a!.id;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("webhook de Mercado Pago (§34.4)", () => {
  it("firma inválida → 401 y evento de seguridad; nada se aplica", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved");
    const r = await deliver(id, { secret: "otraclave000000000000" });
    expect(r.status).toBe(401);
    expect((await state(o.orderId)).status).toBe("pending_payment");
    const [ev] = await admin<{ n: number }[]>`
      select count(*)::int as n from audit.security_events where type = 'payment.webhook_bad_signature'`;
    expect(ev!.n).toBeGreaterThan(0);
  });

  it("firma vieja (replay) → 401; data.id de la URL distinto del firmado → 400", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved");
    expect((await deliver(id, { at: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect((await deliver(id, { queryId: "123" })).status).toBe(400);
    expect((await state(o.orderId)).status).toBe("pending_payment");
  });

  it("collector desconocido → 404 genérico", async () => {
    const r = await deliver("123", { user: "1" });
    expect(r).toEqual({ status: 404, body: { received: false } });
  });

  it("pago confirmado solo por re-consulta; el evento repetido no repite efectos", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved");
    const eventId = String(randomInt(1_000_000, 9_999_999));
    expect((await deliver(id, { eventId })).body.outcome).toBe("paid");
    expect(await state(o.orderId)).toMatchObject({
      status: "open",
      payment_status: "paid",
      paid_total: String(o.amount),
    });
    expect((await deliver(id, { eventId })).body.outcome).toBe("duplicate");
    const [p] = await admin<{ provider_payment_id: string; n: number }[]>`
      select max(provider_payment_id) as provider_payment_id, count(*)::int as n from public.payments
       where order_id = ${o.orderId} and status = 'succeeded'`;
    expect(p).toEqual({ provider_payment_id: id, n: 1 });
  });

  it("rechazado y reintento aprobado en el mismo checkout: el pedido se paga con el aprobado", async () => {
    const o = await order();
    expect((await deliver(charge(o.paymentId, "rejected"))).body.outcome).toBe("failed");
    expect((await state(o.orderId)).payment_status).toBe("failed");
    // Mercado Pago deja reintentar en la misma preferencia: mismo intento, otro cobro.
    const approved = charge(o.paymentId, "approved");
    expect((await deliver(approved)).body.outcome).toBe("paid");
    expect(await state(o.orderId)).toMatchObject({ status: "open", payment_status: "paid" });
    const [p] = await admin<{ provider_payment_id: string }[]>`
      select provider_payment_id from public.payments where id = ${o.paymentId}`;
    expect(p!.provider_payment_id).toBe(approved);
  });

  it("monto alterado → needs_attention y NO pagado", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved", { transaction_amount: 1 });
    expect((await deliver(id)).body.outcome).toBe("mismatch");
    expect(await state(o.orderId)).toMatchObject({
      status: "pending_payment",
      needs_attention: true,
    });
  });

  it("cobro de otro collector → no se aplica", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved", { collector_id: 1 });
    expect((await deliver(id)).body.outcome).toBe("unknown_payment");
    expect((await state(o.orderId)).status).toBe("pending_payment");
  });

  it("OXXO pendiente y después aprobado: un solo cobro, pedido pagado", async () => {
    const o = await order();
    const id = charge(o.paymentId, "pending", { payment_type_id: "ticket" });
    expect((await deliver(id)).body.outcome).toBe("pending");
    expect((await state(o.orderId)).payment_status).toBe("pending");
    payments.get(id)!.status = "approved";
    expect((await deliver(id)).body.outcome).toBe("paid");
    expect((await state(o.orderId)).payment_status).toBe("paid");
  });

  it("segundo cobro aprobado del mismo intento → atención para reembolsar", async () => {
    const o = await order();
    expect((await deliver(charge(o.paymentId, "approved"))).body.outcome).toBe("paid");
    expect((await deliver(charge(o.paymentId, "approved"))).body.outcome).toBe("duplicate");
    expect(await state(o.orderId)).toMatchObject({ payment_status: "paid", needs_attention: true });
  });

  it("producción: un evento de modo prueba se ignora sin tocar el pedido", async () => {
    const o = await order();
    const id = charge(o.paymentId, "approved");
    expect((await deliver(id, { requireLivemode: true })).body.outcome).toBe("ignored");
    expect((await state(o.orderId)).payment_status).not.toBe("paid");
  });

  it("reconciliación: un intento abierto con más de 15 minutos se busca por referencia y se aplica", async () => {
    const o = await order();
    await admin.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`update public.payments set created_at = now() - interval '20 minutes' where id = ${o.paymentId}`;
    });
    charge(o.paymentId, "rejected");
    charge(o.paymentId, "approved");
    expect(
      await reconcileMercadoPagoPayments({ db: worker, provider, log }),
    ).toBeGreaterThanOrEqual(1);
    expect((await state(o.orderId)).payment_status).toBe("paid");
  });
});
