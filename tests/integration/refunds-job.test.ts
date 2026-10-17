import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";
import { createRefundHandlers, reconcileRefunds } from "@/server/orders/refunds";
import { createMercadoPagoProvider } from "@/server/payments/mercadopago";
import { createStripeProvider } from "@/server/payments/stripe";

/** Job refund.execute (GATE0 §18.6) como system_worker: manual, Stripe y Mercado Pago (APIs simuladas). */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
let storeId: string;
let variantId: string;

/** API simulada como la real: el POST con la misma clave repite su primera respuesta; el GET da el estado actual. */
const refundStatuses: string[] = [];
const calls: { method: string; path: string }[] = [];
let createStatus: number = 200;
const created = new Map<string, { id: string; status: string }>();
const current = new Map<string, string>();
const fetchImpl = (async (url: string, init: RequestInit) => {
  const path = new URL(url).pathname;
  const method = init.method ?? "GET";
  calls.push({ method, path });
  if (method === "POST" && path === "/v1/refunds") {
    if (createStatus !== 200) return new Response("{}", { status: createStatus });
    const key = (init.headers as Record<string, string>)["idempotency-key"]!;
    if (!created.has(key)) {
      const id = `re_${key.replace(/-/g, "").slice(0, 12)}`;
      created.set(key, { id, status: refundStatuses.shift() ?? "succeeded" });
      current.set(id, created.get(key)!.status);
    }
    return Response.json(created.get(key));
  }
  const m = /^\/v1\/refunds\/(re_\w+)$/.exec(path);
  if (method === "GET" && m) return Response.json({ id: m[1], status: current.get(m[1]!) });
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
const stripe = createStripeProvider({
  secretKey: "sk_test_integration000",
  webhookSecret: "whsec_integration000000000",
  apiBase: "https://stripe.test",
  fetchImpl,
});
/** Mercado Pago simulado: POST crea el reembolso (estado pendiente) y GET da el estado actual. */
const mpCalls: { method: string; path: string; body?: string }[] = [];
const mpRefunds = new Map<string, string>();
const mercadopago = createMercadoPagoProvider({
  accessToken: "TEST-0000000000000000-000000-refunds",
  webhookSecret: "mprefunds0000000000000",
  apiBase: "https://mp.test",
  fetchImpl: (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    mpCalls.push({ method, path, ...(init.body ? { body: String(init.body) } : {}) });
    if (method === "POST" && /^\/v1\/payments\/\d+\/refunds$/.test(path)) {
      mpRefunds.set("901", "in_process");
      return Response.json({ id: 901, status: "in_process" });
    }
    const m = /^\/v1\/payments\/\d+\/refunds\/(\d+)$/.exec(path);
    if (method === "GET" && m)
      return Response.json({ id: Number(m[1]), status: mpRefunds.get(m[1]!) });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch,
});
const handler = new Map(
  createRefundHandlers({ db: worker, stripe: () => stripe, mercadopago: () => mercadopago }),
).get("refund.execute")!;
const job = (refundId: string) =>
  ({
    id: randomBytes(4).toString("hex"),
    type: "refund.execute",
    payload: { refund_id: refundId },
    storeId,
  }) as unknown as JobRecord;

async function paidOrder(
  provider: "manual" | "stripe" | "mercadopago",
): Promise<{ orderId: string; refundId: string }> {
  const [acct] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${storeId} and provider = ${provider}`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, 1)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token}, ${admin.json({
      email: "r@example.test",
      customer_name: "R",
      payment_account_id: acct!.id,
    })}, 10000, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  const providerPaymentId =
    provider === "mercadopago" ? "123456789" : `pi_${randomBytes(6).toString("hex")}`;
  await admin`update public.payments set provider_payment_id = ${providerPaymentId}
              where id = ${o!.r.payment.id}`;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', ${provider})`;
  const [r] = await admin<{ id: string }[]>`
    select app.request_refund(o, 4000, '[]'::jsonb, false, 'Prueba', ${`reemb-${randomBytes(8).toString("hex")}`}) as id
      from public.orders o where o.id = ${o!.r.order_id}`;
  return { orderId: o!.r.order_id, refundId: r!.id };
}

async function orderState(id: string) {
  const [o] = await admin<{ refunded_total: string; payment_status: string }[]>`
    select refunded_total, payment_status from public.orders where id = ${id}`;
  return o!;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ref_plan', 'ref_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org rf', ${`org-rf-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at, tax_rate_bps)
    values (${org!.id}, 'Tienda rf', ${`rf-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), 0) returning id`;
  storeId = s!.id;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at) values (${storeId}, 'Taza', 'taza', 'active', now())
    returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`RF-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 10, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config) values
    (${storeId}, 'manual', 'active', 'Transferencia', '{}'),
    (${storeId}, 'stripe', 'active', 'Tarjeta', ${admin.json({ stripe_account_id: `acct_${run}refund0000` })}),
    (${storeId}, 'mercadopago', 'active', 'Mercado Pago',
     ${admin.json({ mp_user_id: String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 1e6)) })})`;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("job refund.execute", () => {
  it("manual: el reembolso se registra como hecho por la tienda", async () => {
    const { orderId, refundId } = await paidOrder("manual");
    await handler(job(refundId), { log } as never);
    expect(await orderState(orderId)).toEqual({
      refunded_total: "4000",
      payment_status: "partially_refunded",
    });
    await handler(job(refundId), { log } as never); // repetir: sin efecto
    expect((await orderState(orderId)).refunded_total).toBe("4000");
  });

  it("stripe: pendiente guarda el re_ y los reintentos lo CONSULTAN (no repiten el POST)", async () => {
    const { orderId, refundId } = await paidOrder("stripe");
    refundStatuses.push("pending");
    calls.length = 0;
    await expect(handler(job(refundId), { log } as never)).rejects.toThrow("refund_pending");
    expect((await orderState(orderId)).refunded_total).toBe("0");
    const [r] = await admin<{ provider_refund_id: string }[]>`
      select provider_refund_id from public.refunds where id = ${refundId}`;
    expect(r!.provider_refund_id).toMatch(/^re_/);
    current.set(r!.provider_refund_id, "succeeded"); // Stripe lo completa después
    await handler(job(refundId), { log } as never);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect((await orderState(orderId)).refunded_total).toBe("4000");
  });

  it("mercadopago: crea con idempotencia por el monto en pesos y luego CONSULTA su estado", async () => {
    const { orderId, refundId } = await paidOrder("mercadopago");
    mpCalls.length = 0;
    await expect(handler(job(refundId), { log } as never)).rejects.toThrow("refund_pending");
    expect(mpCalls[0]).toMatchObject({
      method: "POST",
      path: "/v1/payments/123456789/refunds",
      body: JSON.stringify({ amount: 40 }),
    });
    mpRefunds.set("901", "approved"); // Mercado Pago lo completa después
    await handler(job(refundId), { log } as never);
    expect(mpCalls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect((await orderState(orderId)).refunded_total).toBe("4000");
  });

  it("stripe: un rechazo 4xx es definitivo: reembolso fallido y pedido en atención", async () => {
    const { orderId, refundId } = await paidOrder("stripe");
    createStatus = 400;
    try {
      await handler(job(refundId), { log } as never);
    } finally {
      createStatus = 200;
    }
    const [r] = await admin<{ status: string; failure_code: string }[]>`
      select status, failure_code from public.refunds where id = ${refundId}`;
    expect(r).toEqual({ status: "failed", failure_code: "provider_rejected_400" });
    const [o] = await admin<{ needs_attention: boolean }[]>`
      select needs_attention from public.orders where id = ${orderId}`;
    expect(o!.needs_attention).toBe(true);
  });

  it("reconciliación: retoma un pendiente sin job y marca en atención uno sin id tras 23 h", async () => {
    const pending = await paidOrder("stripe");
    refundStatuses.push("pending");
    await expect(handler(job(pending.refundId), { log } as never)).rejects.toThrow(
      "refund_pending",
    );
    const stuck = await paidOrder("stripe");
    await admin.begin(async (sql) => {
      await sql`set local session_replication_role = replica`;
      await sql`update public.refunds set created_at = now() - interval '1 hour' where id = ${pending.refundId}`;
      await sql`update public.refunds set created_at = now() - interval '30 hours' where id = ${stuck.refundId}`;
      await sql`update system.jobs set status = 'dead', finished_at = now(), locked_at = null, locked_by = null
                 where dedupe_key in (${`refund.execute:${pending.refundId}`}, ${`refund.execute:${stuck.refundId}`})`;
    });
    const [p] = await admin<{ provider_refund_id: string }[]>`
      select provider_refund_id from public.refunds where id = ${pending.refundId}`;
    current.set(p!.provider_refund_id, "succeeded");
    calls.length = 0;
    expect(
      await reconcileRefunds({ db: worker, stripe: () => stripe, log }),
    ).toBeGreaterThanOrEqual(1);
    expect((await orderState(pending.orderId)).refunded_total).toBe("4000");
    // El de 30 h sin id del proveedor nunca se vuelve a crear (podría duplicar).
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    const [o] = await admin<{ needs_attention: boolean }[]>`
      select needs_attention from public.orders where id = ${stuck.orderId}`;
    expect(o!.needs_attention).toBe(true);
  });
});
