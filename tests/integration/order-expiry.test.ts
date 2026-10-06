import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";
import { createOrderHandlers } from "@/server/orders/handlers";

/**
 * Expiración de pedidos (GATE0 §17.6) ejecutada como system_worker: el job usa
 * solo EXECUTE de system.*; cancela, libera existencias y cupón.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const run = Math.random().toString(36).slice(2, 8);
const log = createLogger({ sink: () => {} });
let storeId: string;
let variantId: string;
let orderId: string;

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('exp_plan', 'exp_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org exp', ${`org-exp-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at)
    values (${org!.id}, 'Tienda exp', ${`exp-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now()) returning id`;
  storeId = s!.id;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Taza', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`EXP-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 3, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  const [a] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name)
    values (${storeId}, 'manual', 'active', 'Transferencia') returning id`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, 2)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string } }[]>`
    select storefront.place_order(${storeId}, ${token},
      ${admin.json({ email: "exp@example.test", customer_name: "Exp", payment_account_id: a!.id })},
      20000, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  orderId = o!.r.order_id;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

async function reserved(): Promise<number> {
  const [l] = await admin<{ reserved: number }[]>`
    select reserved from public.inventory_levels where variant_id = ${variantId}`;
  return l!.reserved;
}

describe("job orders.expire (system_worker)", () => {
  it("no toca un pedido con la reserva vigente", async () => {
    const handler = new Map(createOrderHandlers({ db: worker })).get("orders.expire")!;
    await handler(
      { id: "j1", type: "orders.expire", payload: {}, storeId: null } as unknown as JobRecord,
      { log } as never,
    );
    const [o] = await admin<
      { status: string }[]
    >`select status from public.orders where id = ${orderId}`;
    expect(o!.status).toBe("pending_payment");
    expect(await reserved()).toBe(2);
  });

  it("cancela el vencido y libera la reserva", async () => {
    await admin`update public.inventory_reservations set expires_at = now() - interval '1 minute'
                where order_id = ${orderId}`;
    let expired = -1;
    const handler = new Map(
      createOrderHandlers({ db: worker, onExpired: (n) => (expired = n) }),
    ).get("orders.expire")!;
    await handler(
      { id: "j2", type: "orders.expire", payload: {}, storeId: null } as unknown as JobRecord,
      { log } as never,
    );
    expect(expired).toBeGreaterThanOrEqual(1);
    const [o] = await admin<{ status: string; cancel_reason: string; payment_status: string }[]>`
      select status, cancel_reason, payment_status from public.orders where id = ${orderId}`;
    expect(o).toEqual({
      status: "cancelled",
      cancel_reason: "payment_expired",
      payment_status: "expired",
    });
    expect(await reserved()).toBe(0);
  });

  it("system_worker no lee tablas directamente", async () => {
    await expect(worker`select count(*) from public.orders`).rejects.toThrow(/permission denied/);
  });
});
