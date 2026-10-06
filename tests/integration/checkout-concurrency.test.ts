import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * place_order bajo concurrencia real (GATE0 §15.5, §17.4, R-07): N compradores,
 * una conexión y una transacción cada uno. Último cupón, última unidad y
 * números de pedido sin huecos ni duplicados.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 30, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);

let storeId: string;
let rateId: string;
let accountId: string;

const token = () => randomBytes(32).toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest();
const address = {
  recipient_name: "Ana",
  line1: "Calle 1",
  city: "Puebla",
  region: "Puebla",
  postal_code: "72000",
  country: "MX",
};

async function product(sku: string, onHand: number, price = 10000): Promise<string> {
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, ${sku}, ${sku.toLowerCase()}, 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${storeId}, ${p!.id}, ${sku}, ${price}, '') returning id`;
  const [level] = await admin<{ id: string }[]>`
    select id from public.inventory_levels where variant_id = ${v!.id}`;
  if (onHand > 0) {
    await admin`select app.apply_inventory_movement(${storeId}, ${level!.id}, 'initial', ${onHand}, 0)`;
  }
  return v!.id;
}

/** Un carrito por comprador con la variante y sus datos de checkout. */
async function cart(variantId: string): Promise<string> {
  const t = token();
  await admin`select storefront.cart_add_item(${storeId}, ${t}, ${variantId}, 1)`;
  return t;
}

function place(cartToken: string, expected: number, code?: string) {
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  return admin`select storefront.place_order(${storeId}, ${cartToken}, ${admin.json({
    email: `c-${randomBytes(4).toString("hex")}@example.test`,
    customer_name: "Comprador",
    shipping_address: address,
    shipping_rate_id: rateId,
    payment_account_id: accountId,
    ...(code ? { discount_code: code } : {}),
  })}, ${expected}, ${idem}, ${sha(`guest-${idem}`)}) as r`;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('chk_plan', 'chk_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org chk', ${`org-chk-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at,
                               prices_include_tax, tax_rate_bps)
    values (${org!.id}, 'Tienda chk', ${`chk-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), true, 1600)
    returning id`;
  storeId = s!.id;
  await admin`insert into public.store_counters (store_id, key, value) values (${storeId}, 'order_number', 1000)`;
  const [z] = await admin<{ id: string }[]>`
    insert into public.shipping_zones (store_id, name, countries) values (${storeId}, 'MX', '{MX}') returning id`;
  const [r] = await admin<{ id: string }[]>`
    insert into public.shipping_rates (store_id, zone_id, name, type, price)
    values (${storeId}, ${z!.id}, 'Estándar', 'flat', 0) returning id`;
  rateId = r!.id;
  const [a] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name)
    values (${storeId}, 'manual', 'active', 'Transferencia') returning id`;
  accountId = a!.id;
});

afterAll(async () => {
  await admin.end();
});

async function counter(): Promise<number> {
  const [row] = await admin<{ value: string }[]>`
    select value from public.store_counters where store_id = ${storeId} and key = 'order_number'`;
  return row ? Number(row.value) : 0;
}

describe("place_order concurrente", () => {
  it("la última unidad: 20 compradores → 1 pedido; el resto insufficient_stock con rollback total", async () => {
    const variantId = await product(`ULT-${run}`, 1);
    const carts = await Promise.all(Array.from({ length: 20 }, () => cart(variantId)));
    const before = await counter();
    const results = await Promise.allSettled(carts.map((c) => place(c, 10000)));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    const reasons = failed.map((f) => (f.reason as Error).message);
    expect(reasons, JSON.stringify(reasons)).toEqual(Array(19).fill("insufficient_stock"));
    expect(await counter()).toBe(before + 1);
    const [orders] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.order_items where variant_id = ${variantId}`;
    expect(orders!.n).toBe(1);
  });

  it("el último cupón: 20 compradores → 1 lo usa; el resto discount_invalid sin pedido", async () => {
    const variantId = await product(`CUP-${run}`, 100);
    await admin`insert into public.discounts (store_id, code, type, value, usage_limit)
                values (${storeId}, ${`ULTIMO${run.toUpperCase()}`}, 'fixed_amount', 1000, 1)`;
    const carts = await Promise.all(Array.from({ length: 20 }, () => cart(variantId)));
    const results = await Promise.allSettled(
      carts.map((c) => place(c, 9000, `ULTIMO${run.toUpperCase()}`)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed.every((f) => (f.reason as Error).message === "discount_invalid")).toBe(true);
    const [d] = await admin<{ times_reserved: number }[]>`
      select times_reserved from public.discounts where store_id = ${storeId} and code = ${`ULTIMO${run.toUpperCase()}`}`;
    expect(d!.times_reserved).toBe(1);
    const [reserved] = await admin<{ reserved: number }[]>`
      select reserved from public.inventory_levels where variant_id = ${variantId}`;
    expect(reserved!.reserved).toBe(1);
  });

  it("números de pedido: 15 pedidos simultáneos sin fila de contador → consecutivos desde el inicio", async () => {
    const variantId = await product(`NUM-${run}`, 100);
    const carts = await Promise.all(Array.from({ length: 15 }, () => cart(variantId)));
    // Sin fila: los primeros pedidos simultáneos competían por crearla (carrera
    // corregida con un upsert atómico). El primero recibe order_number_start.
    await admin`delete from public.store_counters where store_id = ${storeId}`;
    await admin`update public.stores set order_number_start = 5001 where id = ${storeId}`;
    const before = 5000;
    const results = await Promise.all(carts.map((c) => place(c, 10000)));
    const ids = results.map((r) => (r[0]!.r as { order_id: string }).order_id);
    const numbers = await admin<{ number: string }[]>`
      select number from public.orders where id = any(${ids}::uuid[]) order by number`;
    expect(numbers.map((n) => Number(n.number))).toEqual(
      Array.from({ length: 15 }, (_, i) => before + 1 + i),
    );
  });

  it("doble envío simultáneo con la misma clave → un solo pedido", async () => {
    const variantId = await product(`DBL-${run}`, 5);
    const c = await cart(variantId);
    const idem = `idem-${randomBytes(12).toString("hex")}`;
    const input = admin.json({
      email: "doble@example.test",
      customer_name: "Doble",
      shipping_address: address,
      shipping_rate_id: rateId,
      payment_account_id: accountId,
    });
    const send = () =>
      admin`select storefront.place_order(${storeId}, ${c}, ${input}, 10000, ${idem}, ${sha(`g-${idem}`)}) as r`;
    const [a, b] = await Promise.all([send(), send()]);
    const ra = a[0]!.r as { order_id: string; replayed: boolean };
    const rb = b[0]!.r as { order_id: string; replayed: boolean };
    expect(ra.order_id).toBe(rb.order_id);
    expect([ra.replayed, rb.replayed].sort()).toEqual([false, true]);
  });
});
