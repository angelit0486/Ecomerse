import { createHash, createHmac, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "@/server/observability/logger";
import { createStripeProvider } from "@/server/payments/stripe";
import { handleStripeWebhook, reconcilePayments } from "@/server/payments/webhook";

/**
 * Webhook de Stripe Connect (GATE0 §18.4, §34.4) contra PostgreSQL real con el
 * rol system_worker; la API de Stripe se simula (re-consulta = fuente de verdad).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "whsec_integration000000000";
const ACCOUNT = `acct_${run}000000000`;

/** Sesiones que devuelve la API simulada, por id. */
const sessions = new Map<string, Record<string, unknown>>();
const fetchImpl = (async (url: string) => {
  const id = new URL(url).pathname.split("/").pop()!;
  const s = sessions.get(id);
  return new Response(JSON.stringify(s ?? { error: {} }), { status: s ? 200 : 404 });
}) as unknown as typeof fetch;
const provider = createStripeProvider({
  secretKey: "sk_test_integration000",
  webhookSecret: SECRET,
  apiBase: "https://stripe.test",
  fetchImpl,
});

let storeId: string;
let accountId: string;
let variantId: string;

async function order(
  qty = 1,
): Promise<{ orderId: string; paymentId: string; checkoutId: string; amount: number }> {
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, ${qty})`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token},
      ${admin.json({ email: `c-${randomBytes(3).toString("hex")}@example.test`, customer_name: "C", payment_account_id: accountId })},
      ${10000 * qty}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  const checkoutId = `cs_test_${randomBytes(8).toString("hex")}`;
  await admin`select storefront.record_checkout_result(${storeId}, ${o!.r.payment.id}, true, ${checkoutId})`;
  sessions.set(checkoutId, {
    id: checkoutId,
    url: null,
    status: "open",
    payment_status: "unpaid",
    amount_total: 10000 * qty,
    currency: "mxn",
    client_reference_id: o!.r.payment.id,
    payment_intent: `pi_${randomBytes(6).toString("hex")}`,
    payment_method_types: ["card"],
  });
  return { orderId: o!.r.order_id, paymentId: o!.r.payment.id, checkoutId, amount: 10000 * qty };
}

function event(
  checkoutId: string,
  opts: { type?: string; id?: string; account?: string; reference?: string } = {},
) {
  return JSON.stringify({
    id: opts.id ?? `evt_${randomBytes(8).toString("hex")}`,
    type: opts.type ?? "checkout.session.completed",
    account: opts.account ?? ACCOUNT,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: { id: checkoutId, object: "checkout.session", client_reference_id: opts.reference },
    },
  });
}

function deliver(body: string, opts: { secret?: string; at?: number } = {}) {
  const t = opts.at ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${t}.${body}`)
    .digest("hex");
  return handleStripeWebhook({
    db: worker,
    provider,
    headers: new Headers({ "stripe-signature": `t=${t},v1=${sig}` }),
    rawBody: body,
    now: new Date(),
    log,
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
    insert into public.plans (key, name) values ('stripe_plan', 'stripe_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org st', ${`org-st-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at,
                               prices_include_tax, tax_rate_bps)
    values (${org!.id}, 'Tienda st', ${`st-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), true, 0)
    returning id`;
  storeId = s!.id;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Taza', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`ST-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  const [a] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
    values (${storeId}, 'stripe', 'active', 'Tarjeta', ${admin.json({ stripe_account_id: ACCOUNT })}) returning id`;
  accountId = a!.id;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("webhook de Stripe (§34.4)", () => {
  it("firma inválida → 401 y evento de seguridad; nada se aplica", async () => {
    const o = await order();
    sessions.get(o.checkoutId)!.payment_status = "paid";
    const r = await deliver(event(o.checkoutId), { secret: "whsec_otro00000000000" });
    expect(r.status).toBe(401);
    expect((await state(o.orderId)).status).toBe("pending_payment");
    const [ev] = await admin<{ n: number }[]>`
      select count(*)::int as n from audit.security_events where type = 'payment.webhook_bad_signature'`;
    expect(ev!.n).toBeGreaterThan(0);
  });

  it("marca de tiempo vencida (replay) → 401", async () => {
    const o = await order();
    const r = await deliver(event(o.checkoutId), { at: Math.floor(Date.now() / 1000) - 600 });
    expect(r.status).toBe(401);
  });

  it("cuenta inexistente → 404 genérico", async () => {
    const r = await deliver(event("cs_test_nada0000000", { account: "acct_noexiste000000" }));
    expect(r).toEqual({ status: 404, body: { received: false } });
  });

  it("pago confirmado por re-consulta; el duplicado no repite efectos", async () => {
    const o = await order();
    sessions.get(o.checkoutId)!.payment_status = "paid";
    sessions.get(o.checkoutId)!.status = "complete";
    const body = event(o.checkoutId);
    expect((await deliver(body)).body.outcome).toBe("paid");
    expect(await state(o.orderId)).toMatchObject({
      status: "open",
      payment_status: "paid",
      paid_total: String(o.amount),
    });
    expect((await deliver(body)).body.outcome).toBe("duplicate");
    const [n] = await admin<
      { n: number }[]
    >`select count(*)::int as n from public.payments where order_id = ${o.orderId}
                                             and status = 'succeeded'`;
    expect(n!.n).toBe(1);
  });

  it("fuera de orden: un evento posterior que la re-consulta contradice no retrocede el pago", async () => {
    const o = await order();
    sessions.get(o.checkoutId)!.payment_status = "paid";
    await deliver(event(o.checkoutId));
    // Llega tarde un evento de fallo; la sesión re-consultada sigue pagada → sin cambios.
    expect(
      (await deliver(event(o.checkoutId, { type: "checkout.session.async_payment_failed" }))).body
        .outcome,
    ).toBe("ignored");
    expect((await state(o.orderId)).payment_status).toBe("paid");
  });

  it("monto alterado → needs_attention y NO pagado", async () => {
    const o = await order();
    Object.assign(sessions.get(o.checkoutId)!, { payment_status: "paid", amount_total: 1 });
    expect((await deliver(event(o.checkoutId))).body.outcome).toBe("mismatch");
    expect(await state(o.orderId)).toMatchObject({
      status: "pending_payment",
      needs_attention: true,
    });
  });

  it("moneda alterada → mismatch", async () => {
    const o = await order();
    Object.assign(sessions.get(o.checkoutId)!, { payment_status: "paid", currency: "usd" });
    expect((await deliver(event(o.checkoutId))).body.outcome).toBe("mismatch");
    expect((await state(o.orderId)).status).toBe("pending_payment");
  });

  it("referencia de otro pedido → mismatch; sesión desconocida → unknown_payment", async () => {
    const a = await order();
    const b = await order();
    Object.assign(sessions.get(a.checkoutId)!, {
      payment_status: "paid",
      client_reference_id: b.paymentId,
    });
    expect((await deliver(event(a.checkoutId))).body.outcome).toBe("mismatch");
    expect((await state(a.orderId)).status).toBe("pending_payment");
    expect((await state(b.orderId)).status).toBe("pending_payment");
    expect((await deliver(event("cs_test_desconocida00"))).body.outcome).toBe("unknown_payment");
  });

  it("pago tardío sobre pedido vencido con existencias → se reabre y se cobra", async () => {
    const o = await order(2);
    await admin`update public.inventory_reservations set expires_at = now() - interval '1 minute'
                where order_id = ${o.orderId}`;
    await admin`select system.expire_orders()`;
    expect((await state(o.orderId)).status).toBe("cancelled");
    sessions.get(o.checkoutId)!.payment_status = "paid";
    expect((await deliver(event(o.checkoutId))).body.outcome).toBe("late_paid");
    expect(await state(o.orderId)).toMatchObject({ status: "open", payment_status: "paid" });
    const [r] = await admin<{ status: string }[]>`
      select status from public.inventory_reservations where order_id = ${o.orderId} and status = 'committed'`;
    expect(r?.status).toBe("committed");
  });

  it("pago tardío sin existencias → cancelado, pagado y en atención para reembolsar", async () => {
    const o = await order(3);
    await admin`update public.inventory_reservations set expires_at = now() - interval '1 minute'
                where order_id = ${o.orderId}`;
    await admin`select system.expire_orders()`;
    // Se vende todo lo disponible mientras tanto.
    const [l] = await admin<{ id: string; available: number }[]>`
      select id, available from public.inventory_levels where variant_id = ${variantId}`;
    await admin`select app.apply_inventory_movement(${storeId}, ${l!.id}, 'adjustment', ${-l!.available}, 0, 'Prueba: agotar')`;
    sessions.get(o.checkoutId)!.payment_status = "paid";
    expect((await deliver(event(o.checkoutId))).body.outcome).toBe("late_without_stock");
    expect(await state(o.orderId)).toMatchObject({
      status: "cancelled",
      payment_status: "paid",
      needs_attention: true,
    });
    await admin`select app.apply_inventory_movement(${storeId}, ${l!.id}, 'adjustment', 20, 0, 'Prueba: reponer')`;
  });

  it("reconciliación: un intento abierto con más de 15 minutos se re-consulta y aplica", async () => {
    const o = await order();
    // created_at es inmutable: se envejece el intento solo en esta prueba, sin triggers.
    await admin.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`update public.payments set created_at = now() - interval '20 minutes' where id = ${o.paymentId}`;
    });
    sessions.get(o.checkoutId)!.payment_status = "paid";
    expect(await reconcilePayments({ db: worker, provider, log })).toBeGreaterThanOrEqual(1);
    expect((await state(o.orderId)).payment_status).toBe("paid");
  });
});
