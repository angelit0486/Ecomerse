import { createHash, randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * F7-T06: 100 checkouts con fallos aleatorios → cero estados inconsistentes.
 * Cada pedido sigue un escenario elegido con una semilla fija (reproducible):
 * pagos que fallan y se reintentan, duplicados, montos alterados, vencimientos,
 * pagos tardíos (CF-04), cancelaciones, envíos parciales y reembolsos que fallan
 * o se confirman. Al final se verifican las invariantes de inventario, dinero y
 * estados contra la base. Una operación rechazada es válida; un estado
 * incoherente, nunca.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const SEED = Number(process.env.CHAOS_SEED ?? 20261007);
const ORDERS = 100;
const INITIAL_STOCK = 150;
const run = Math.random().toString(36).slice(2, 8);
let storeId: string;
let ownerId: string;
let variantId: string;
let fakeAccount: string;
let stripeAccount: string;

/** mulberry32: PRNG determinista para reproducir un fallo con CHAOS_SEED. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

/** Ejecuta como el dueño de la tienda (claims del JWT, como PostgREST). */
async function asOwner<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({
      sub: ownerId,
      role: "authenticated",
      aal: "aal2",
    })}, true), set_config('role', 'authenticated', true)`;
    return fn(sql);
  })) as T;
}

/** Una operación puede ser rechazada por las reglas: se cuenta, no rompe la prueba. */
const outcomes = new Map<string, number>();
async function attempt(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    outcomes.set(`${label}:ok`, (outcomes.get(`${label}:ok`) ?? 0) + 1);
  } catch (error) {
    const code = (error as { message?: string }).message ?? "error";
    if (
      !/^(conflict|validation_failed|not_found|out_of_stock|insufficient_stock|limit_reached|reservation_expired)/.test(
        code,
      )
    ) {
      throw error;
    }
    outcomes.set(`${label}:${code}`, (outcomes.get(`${label}:${code}`) ?? 0) + 1);
  }
}

async function placeOrder(qty: number, account: string) {
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, ${qty})`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token}, ${admin.json({
      email: `c-${randomBytes(3).toString("hex")}@example.test`,
      customer_name: "C",
      payment_account_id: account,
    })}, ${10000 * qty}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  return { orderId: o!.r.order_id, paymentId: o!.r.payment.id, amount: 10000 * qty };
}

async function lastPayment(orderId: string) {
  const [p] = await admin<{ id: string; provider: string; amount: string }[]>`
    select id, provider, amount from public.payments where order_id = ${orderId} order by created_at desc limit 1`;
  return p!;
}

/** Resultado del proveedor: fake directo o Stripe por apply_payment_status (§18.4.5-6). */
async function providerResult(orderId: string, outcome: "succeeded" | "failed", tamper = false) {
  const p = await lastPayment(orderId);
  if (p.provider === "fake") {
    await admin`select system.fake_payment_result(${p.id}, ${outcome})`;
    return;
  }
  await admin`select system.apply_payment_status(${p.id}, ${admin.json({
    status: outcome,
    amount: Number(p.amount) + (tamper ? 1 : 0),
    currency: "MXN",
    provider_payment_id: `pi_${randomBytes(6).toString("hex")}`,
    external_reference: p.id,
    method: "card",
    failure_code: outcome === "failed" ? "card_declined" : null,
  })})`;
}

async function retry(orderId: string) {
  // El reintento llega por el storefront con el token del invitado; aquí basta un
  // pago nuevo sobre el mismo pedido mientras la reserva siga vigente.
  const [o] = await admin<{ guest_access_token_hash: Buffer }[]>`
    select guest_access_token_hash from public.orders where id = ${orderId}`;
  await admin`select storefront.retry_payment(${storeId}, ${orderId}, ${o!.guest_access_token_hash})`;
}

async function expire(orderId: string) {
  await admin.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`update public.inventory_reservations set expires_at = now() - interval '1 minute'
               where order_id = ${orderId} and status = 'active'`;
  });
  await admin`select system.expire_orders(200)`;
}

async function cancel(orderId: string) {
  await asOwner(
    (sql) =>
      sql`select public.orders_cancel(${storeId}, ${orderId}, ${pick(["customer", "staff", "fraud"])}, null,
                                      ${`cancel-${randomBytes(10).toString("hex")}`})`,
  );
}

async function fulfill(orderId: string, all: boolean) {
  const [item] = await admin<{ id: string; quantity: number }[]>`
    select id, quantity from public.order_items where order_id = ${orderId} limit 1`;
  const qty = all ? item!.quantity : Math.max(1, Math.floor(rand() * item!.quantity));
  await asOwner(
    (sql) =>
      sql`select public.orders_fulfill(${storeId}, ${orderId},
            ${sql.json([{ order_item_id: item!.id, quantity: qty }])}, null, null, null,
            ${`envio-${randomBytes(10).toString("hex")}`})`,
  );
}

async function refund(orderId: string, restock: boolean) {
  const [o] = await admin<{ paid_total: string; refunded_total: string }[]>`
    select paid_total, refunded_total from public.orders where id = ${orderId}`;
  const available = Number(o!.paid_total) - Number(o!.refunded_total);
  const amount = Math.max(1, Math.floor(rand() * available));
  const [shipped] = await admin<{ id: string; q: number }[]>`
    select si.order_item_id as id, sum(si.quantity)::int as q from public.shipment_items si
      join public.shipments s on s.store_id = si.store_id and s.id = si.shipment_id
     where s.order_id = ${orderId} group by si.order_item_id limit 1`;
  const items = restock && shipped ? [{ order_item_id: shipped.id, quantity: 1 }] : [];
  const [r] = await asOwner(
    (sql) =>
      sql<{ id: string }[]>`select public.orders_request_refund(${storeId}, ${orderId}, ${amount},
            ${sql.json(items)}, ${items.length > 0}, null, ${`reemb-${randomBytes(10).toString("hex")}`}) as id`,
  );
  await settleRefund(r!.id);
}

async function settleRefund(refundId: string) {
  const ok = chance(0.8);
  await admin`select system.apply_refund_result(${refundId}, ${ok ? "succeeded" : "failed"},
                                                ${ok ? `re_${randomBytes(4).toString("hex")}` : null},
                                                ${ok ? null : "provider_declined"})`;
}

async function settlePendingRefunds(orderId: string) {
  const pending = await admin<{ id: string }[]>`
    select id from public.refunds where order_id = ${orderId} and status = 'pending'`;
  for (const r of pending) await settleRefund(r.id);
}

const SCENARIOS = [
  "pay",
  "fail_then_retry_pay",
  "fail_only",
  "abandon_expire",
  "duplicate_success",
  "tampered_amount",
  "late_payment",
  "pay_cancel",
  "pay_fulfill_partial_refund",
  "pay_fulfill_all_refund_restock",
  "unpaid_cancel",
] as const;

async function scenario(name: (typeof SCENARIOS)[number], orderId: string) {
  switch (name) {
    case "pay":
      return attempt("pay", () => providerResult(orderId, "succeeded"));
    case "fail_then_retry_pay":
      await attempt("fail", () => providerResult(orderId, "failed"));
      await attempt("retry", () => retry(orderId));
      return attempt("pay", () => providerResult(orderId, "succeeded"));
    case "fail_only":
      await attempt("fail", () => providerResult(orderId, "failed"));
      return chance(0.5) ? attempt("expire", () => expire(orderId)) : undefined;
    case "abandon_expire":
      return attempt("expire", () => expire(orderId));
    case "duplicate_success":
      await attempt("pay", () => providerResult(orderId, "succeeded"));
      return attempt("pay_again", () => providerResult(orderId, "succeeded"));
    case "tampered_amount":
      return attempt("tampered", () => providerResult(orderId, "succeeded", true));
    case "late_payment":
      await attempt("expire", () => expire(orderId));
      return attempt("late_pay", () => providerResult(orderId, "succeeded"));
    case "pay_cancel":
      await attempt("pay", () => providerResult(orderId, "succeeded"));
      await attempt("cancel", () => cancel(orderId));
      return attempt("settle", () => settlePendingRefunds(orderId));
    case "pay_fulfill_partial_refund":
      await attempt("pay", () => providerResult(orderId, "succeeded"));
      await attempt("fulfill", () => fulfill(orderId, false));
      return attempt("refund", () => refund(orderId, false));
    case "pay_fulfill_all_refund_restock":
      await attempt("pay", () => providerResult(orderId, "succeeded"));
      await attempt("fulfill", () => fulfill(orderId, true));
      await attempt("refund", () => refund(orderId, true));
      return chance(0.5) ? attempt("refund_more", () => refund(orderId, false)) : undefined;
    case "unpaid_cancel":
      return attempt("cancel", () => cancel(orderId));
  }
}

beforeAll(async () => {
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do update set value = excluded.value`;
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('chaos_plan', 'chaos_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100), (${plan!.id}, 'max_staff', 20)
              on conflict do nothing`;
  ownerId = randomUUID();
  await admin`insert into auth.users (id, email) values (${ownerId}, ${`owner-${run}@chaos.test`})`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org chaos', ${`org-chaos-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at, tax_rate_bps)
    values (${org!.id}, 'Tienda chaos', ${`chaos-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), 0)
    returning id`;
  storeId = s!.id;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Taza', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`CH-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', ${INITIAL_STOCK}, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  const accounts = await admin<{ id: string; provider: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name, public_config) values
      (${storeId}, 'fake', 'active', 'Prueba', '{}'),
      (${storeId}, 'stripe', 'active', 'Tarjeta', ${admin.json({ stripe_account_id: `acct_${run}chaos000` })})
    returning id, provider`;
  fakeAccount = accounts.find((a) => a.provider === "fake")!.id;
  stripeAccount = accounts.find((a) => a.provider === "stripe")!.id;
}, 60_000);

afterAll(async () => {
  await admin.end();
});

describe(`caos de pedidos (semilla ${SEED})`, () => {
  it(`${ORDERS} checkouts con fallos aleatorios dejan cero estados inconsistentes`, async () => {
    for (let i = 0; i < ORDERS; i += 1) {
      const qty = 1 + Math.floor(rand() * 3);
      const account = chance(0.5) ? fakeAccount : stripeAccount;
      let placed: Awaited<ReturnType<typeof placeOrder>> | null = null;
      await attempt("place", async () => {
        placed = await placeOrder(qty, account);
      });
      if (placed) await scenario(pick(SCENARIOS), (placed as { orderId: string }).orderId);
    }

    // ---------------------------------------------------------------- Invariantes
    const violations = await admin<{ rule: string; id: string }[]>`
      with lvl as (
        select l.id, l.on_hand, l.reserved,
               (select coalesce(sum(m.on_hand_delta), 0) from public.inventory_movements m where m.level_id = l.id) as ledger_on_hand,
               (select coalesce(sum(m.reserved_delta), 0) from public.inventory_movements m where m.level_id = l.id) as ledger_reserved,
               (select coalesce(sum(i.quantity - i.fulfilled_quantity - i.released_quantity), 0)
                  from public.inventory_reservation_items i
                  join public.inventory_reservations r on r.store_id = i.store_id and r.id = i.reservation_id
                 where i.level_id = l.id and r.status in ('active', 'committed')) as held
          from public.inventory_levels l where l.store_id = ${storeId}
      ), ord as (
        select o.*,
               (select coalesce(sum(r.amount), 0) from public.refunds r
                 where r.order_id = o.id and r.status = 'succeeded') as refunds_ok,
               (select count(*) from public.payments p where p.order_id = o.id and p.status = 'succeeded') as payments_ok,
               (select count(*) from public.inventory_reservations r where r.order_id = o.id and r.status = 'active') as res_active,
               (select count(*) from public.inventory_reservations r
                 where r.order_id = o.id and r.status in ('active', 'committed')) as res_held,
               (select coalesce(sum(si.quantity), 0) from public.shipment_items si
                  join public.shipments s on s.store_id = si.store_id and s.id = si.shipment_id
                 where s.order_id = o.id) as shipped,
               (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id) as ordered
          from public.orders o where o.store_id = ${storeId}
      )
      select 'ledger_on_hand' as rule, id::text from lvl where on_hand <> ledger_on_hand
      union all select 'ledger_reserved', id::text from lvl where reserved <> ledger_reserved
      union all select 'reserved_matches_reservations', id::text from lvl where reserved <> held
      union all select 'stock_non_negative', id::text from lvl where on_hand < 0 or reserved < 0 or reserved > on_hand
      union all select 'refunded_total_matches_refunds', id::text from ord where refunded_total <> refunds_ok
      union all select 'refund_le_paid', id::text from ord where refunded_total > paid_total or paid_total > total
      union all select 'paid_status_money', id::text from ord
        where (payment_status = 'paid' and (paid_total <> total or refunded_total <> 0))
           or (payment_status = 'partially_refunded' and not (refunded_total > 0 and refunded_total < paid_total))
           or (payment_status = 'refunded' and not (refunded_total = paid_total and paid_total > 0))
           or (payment_status in ('unpaid', 'pending', 'failed', 'expired') and paid_total <> 0)
      union all select 'paid_has_payment', id::text from ord where paid_total > 0 and payments_ok = 0
      union all select 'double_charge_flagged', id::text from ord where payments_ok > 1 and not needs_attention
      union all select 'pending_has_active_reservation', id::text from ord
        where status = 'pending_payment' and res_active <> 1
      union all select 'open_paid_no_active_hold', id::text from ord where status <> 'pending_payment' and res_active > 0
      union all select 'cancelled_releases_stock', id::text from ord where status = 'cancelled' and res_held > 0
      union all select 'cancelled_paid_needs_attention', id::text from ord
        where status = 'cancelled' and paid_total > refunded_total
          and not needs_attention
          and not exists (select 1 from public.refunds r where r.order_id = ord.id and r.status = 'pending')
      union all select 'shipped_le_ordered', id::text from ord where shipped > ordered
      union all select 'unpaid_not_shipped', id::text from ord where shipped > 0 and paid_total = 0`;

    const summary = Object.fromEntries([...outcomes.entries()].sort());
    if (process.env.CHAOS_REPORT) {
      (await import("node:fs")).writeFileSync(
        process.env.CHAOS_REPORT,
        JSON.stringify(summary, null, 1),
      );
    }
    // Si algo falla, el mensaje dice qué regla y la semilla para reproducirlo.
    expect(violations, `semilla ${SEED}: ${JSON.stringify(summary)}`).toEqual([]);
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.orders where store_id = ${storeId}`;
    expect(count!.n).toBeGreaterThanOrEqual(80);
  }, 240_000);
});
