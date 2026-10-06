import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Concurrencia del inventario (GATE0 §15.5, F4-T02) contra PostgreSQL real:
 * cada llamada va en su propia conexión y su propia transacción, como dos
 * checkouts simultáneos. Ejecutar con `pnpm db:test`.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 40, onnotice: () => {} });

let storeId = "";
const run = randomBytes(3).toString("hex");
const expires = () => new Date(Date.now() + 15 * 60_000);

async function variant(sku: string, opts: { onHand: number; policy?: "deny" | "continue" }) {
  const [product] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug) values (${storeId}, ${sku}, ${`${sku.toLowerCase()}-${run}`})
    returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, inventory_policy, option_signature)
    values (${storeId}, ${product!.id}, ${`${sku}-${run}`}, 100, ${opts.policy ?? "deny"}, '') returning id`;
  const [level] = await admin<
    { id: string }[]
  >`select app.default_level(${storeId}, ${v!.id}) as id`;
  if (opts.onHand > 0) {
    await admin`select app.apply_inventory_movement(${storeId}, ${level!.id}, 'initial', ${opts.onHand}, 0)`;
  }
  return { variantId: v!.id, levelId: level!.id };
}

async function level(levelId: string) {
  const [row] = await admin<{ on_hand: number; reserved: number; available: number }[]>`
    select on_hand, reserved, available from public.inventory_levels where id = ${levelId}`;
  return row!;
}

function reserve(items: { variantId: string; quantity: number }[]) {
  return admin`select app.inventory_reserve(${storeId}, gen_random_uuid(),
    ${admin.json(items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })))}, ${expires()})`;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('inv_plan', 'inv_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org inv', ${`org-inv-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda inv', ${`inv-${run}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
});

afterAll(async () => {
  await admin.end();
});

describe("el último SKU", () => {
  it("20 compradores por 1 unidad → exactamente 1 reserva; el resto insufficient_stock", async () => {
    const last = await variant("ULTIMO-1", { onHand: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserve([{ variantId: last.variantId, quantity: 1 }])),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(19);
    expect(failed.every((f) => (f.reason as Error).message === "insufficient_stock")).toBe(true);
    expect(await level(last.levelId)).toEqual({ on_hand: 1, reserved: 1, available: 0 });
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.inventory_reservation_items where level_id = ${last.levelId}`;
    expect(count!.n).toBe(1); // los 19 fallidos se revirtieron por completo
  });

  it("con 5 unidades y 20 compradores de 1 → exactamente 5", async () => {
    const five = await variant("CINCO-1", { onHand: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserve([{ variantId: five.variantId, quantity: 1 }])),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await level(five.levelId)).toMatchObject({ reserved: 5, available: 0 });
  });
});

describe("pedidos multilínea", () => {
  it("40 pedidos [A, B] y [B, A] a la vez: sin deadlocks (orden por level_id)", async () => {
    const a = await variant("MULTI-A", { onHand: 100 });
    const b = await variant("MULTI-B", { onHand: 100 });
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        reserve(
          i % 2 === 0
            ? [
                { variantId: a.variantId, quantity: 1 },
                { variantId: b.variantId, quantity: 1 },
              ]
            : [
                { variantId: b.variantId, quantity: 1 },
                { variantId: a.variantId, quantity: 1 },
              ],
        ),
      ),
    );
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(errors.map((e) => (e.reason as { code?: string }).code)).toEqual([]);
    expect((await level(a.levelId)).reserved).toBe(40);
    expect((await level(b.levelId)).reserved).toBe(40);
  });
});

describe("idempotencia bajo concurrencia", () => {
  it("10 llamadas simultáneas con la misma clave aplican el movimiento una vez", async () => {
    const v = await variant("IDEM-1", { onHand: 0 });
    const results = await Promise.allSettled(
      Array.from(
        { length: 10 },
        () => admin`select app.apply_inventory_movement(${storeId}, ${v.levelId}, 'purchase', 5, 0,
                      null, 'manual', null, ${`compra-${run}`})`,
      ),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await level(v.levelId)).on_hand).toBe(5);
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.inventory_movements where level_id = ${v.levelId}`;
    expect(count!.n).toBe(1); // un solo movimiento para la clave
  });

  it("el ledger cuadra con todos los niveles tras la carga", async () => {
    const mismatches = await admin`select * from system.inventory_ledger_mismatches()`;
    expect(mismatches).toHaveLength(0);
  });
});
