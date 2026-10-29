import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * ADR-046: el mantenimiento (system.enqueue_maintenance, cada pocos minutos)
 * anonimiza las tiendas cerradas hace más de 30 días. Como system_worker, dentro
 * de una transacción que se revierte.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);

class Rollback extends Error {}

afterAll(() => admin.end());

describe("anonimización de tiendas cerradas", () => {
  it("el mantenimiento anonimiza los pedidos de una tienda cerrada hace 31 días", async () => {
    await admin
      .begin(async (tx) => {
        const [plan] = await tx<{ id: string }[]>`
          insert into public.plans (key, name) values ('anon_plan', 'anon_plan')
          on conflict (key) do update set name = excluded.name returning id`;
        await tx`insert into public.plan_entitlements (plan_id, key, value_int)
                 values (${plan!.id}, 'max_stores', 5) on conflict (plan_id, key) do nothing`;
        const [org] = await tx<{ id: string }[]>`
          insert into public.organizations (name, slug, country) values ('Org anon', ${`org-anon-${run}`}, 'MX')
          returning id`;
        await tx`insert into public.subscriptions (organization_id, plan_id, status)
                 values (${org!.id}, ${plan!.id}, 'active')`;
        const [store] = await tx<{ id: string }[]>`
          insert into public.stores (organization_id, name, handle, currency, country, timezone)
          values (${org!.id}, 'Cerrada', ${`anon-${run}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
        const [order] = await tx<{ id: string }[]>`
          insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                                     requires_shipping, currency, prices_include_tax, tax_rate_bps,
                                     tax_applies_to_shipping, subtotal, discount_total, shipping_total, tax_total, total)
          values (${store!.id}, 1001, '#1001', ${`idem-anon-${run}-0000000000`}, 'compradora@correo.test', 'Compradora Real', false,
                  'MXN', true, 1600, true, 25000, 0, 0, 0, 25000)
          returning id`;
        await tx`update public.stores set status = 'closed', closed_at = now() - interval '31 days'
                  where id = ${store!.id}`;

        await tx`set local role system_worker`;
        await tx`select system.enqueue_maintenance()`;
        await tx`reset role`;

        const [o] = await tx<{ email: string; customer_name: string; total: string }[]>`
          select email, customer_name, total::text from public.orders where id = ${order!.id}`;
        expect(o).toEqual({
          email: `anonimo-${order!.id.replaceAll("-", "")}@anonimizado.invalid`,
          customer_name: "Anónimo",
          total: "25000",
        });
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
