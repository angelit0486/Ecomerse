import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";
import { createRefundHandlers } from "@/server/orders/refunds";
import { createStripeProvider } from "@/server/payments/stripe";

/** Job refund.execute (GATE0 §18.6) como system_worker: manual y Stripe (API simulada). */
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

const refundStatuses: string[] = [];
const fetchImpl = (async () =>
  new Response(JSON.stringify({ id: "re_test_1", status: refundStatuses.shift() ?? "succeeded" }), {
    status: 200,
  })) as unknown as typeof fetch;
const stripe = createStripeProvider({
  secretKey: "sk_test_integration000",
  webhookSecret: "whsec_integration000000000",
  apiBase: "https://stripe.test",
  fetchImpl,
});
const handler = new Map(createRefundHandlers({ db: worker, stripe: () => stripe })).get(
  "refund.execute",
)!;
const job = (refundId: string) =>
  ({
    id: randomBytes(4).toString("hex"),
    type: "refund.execute",
    payload: { refund_id: refundId },
    storeId,
  }) as unknown as JobRecord;

async function paidOrder(
  provider: "manual" | "stripe",
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
  await admin`update public.payments set provider_payment_id = ${`pi_${randomBytes(6).toString("hex")}`}
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
    (${storeId}, 'stripe', 'active', 'Tarjeta', ${admin.json({ stripe_account_id: `acct_${run}refund0000` })})`;
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

  it("stripe: pendiente se reintenta con la misma clave; al confirmarse se aplica", async () => {
    const { orderId, refundId } = await paidOrder("stripe");
    refundStatuses.push("pending", "succeeded");
    await expect(handler(job(refundId), { log } as never)).rejects.toThrow("refund_pending");
    expect((await orderState(orderId)).refunded_total).toBe("0");
    await handler(job(refundId), { log } as never);
    expect((await orderState(orderId)).refunded_total).toBe("4000");
  });
});
