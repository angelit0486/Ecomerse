import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Listado del panel con 100 por página (misión vendible F3). La base devuelve como
 * máximo 100 filas, así que el panel no puede pedir la 101 para saber si hay más:
 * pregunta por una fila después de la última. Aquí se fija ese contrato de la base.
 * Todo corre en una transacción que se revierte.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);

class Rollback extends Error {}

afterAll(() => admin.end());

type Row = { id: string; title: string; sort_key: string };

describe("catalog_search_products con 100 por página", () => {
  it("devuelve como máximo 100 y el cursor tras la última fila encuentra lo que falta", async () => {
    await admin
      .begin(async (tx) => {
        const [plan] = await tx<{ id: string }[]>`
          insert into public.plans (key, name) values ('page_plan', 'page_plan')
          on conflict (key) do update set name = excluded.name returning id`;
        await tx`insert into public.plan_entitlements (plan_id, key, value_int)
                 values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 1000)
                 on conflict (plan_id, key) do update set value_int = excluded.value_int`;
        const [org] = await tx<{ id: string }[]>`
          insert into public.organizations (name, slug, country)
          values ('Org página', ${`org-pagina-${run}`}, 'MX') returning id`;
        await tx`insert into public.subscriptions (organization_id, plan_id, status)
                 values (${org!.id}, ${plan!.id}, 'active')`;
        const [store] = await tx<{ id: string }[]>`
          insert into public.stores (organization_id, name, handle, currency, country, timezone)
          values (${org!.id}, 'Tienda página', ${`pagina-${run}`}, 'MXN', 'MX', 'America/Mexico_City')
          returning id`;
        const [user] = await tx<{ id: string }[]>`
          insert into auth.users (id, email) values (gen_random_uuid(), ${`pagina-${run}@test.io`})
          returning id`;
        await tx`insert into public.organization_members (organization_id, user_id, role)
                 values (${org!.id}, ${user!.id}, 'org_owner')`;
        await tx`insert into public.products (store_id, title, slug, status)
                 select ${store!.id}, 'Producto ' || lpad(g::text, 3, '0'), 'producto-' || g, 'draft'
                   from generate_series(1, 101) g`;

        await tx`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: user!.id,
          role: "authenticated",
          aal: "aal2",
        })}, true), set_config('role', 'authenticated', true)`;
        const search = (cursor: { k: string; id: string } | null, limit: number) =>
          tx<Row[]>`select id, title, sort_key from public.catalog_search_products(
                      ${store!.id}, null, null, null, false, ${cursor ? tx.json(cursor) : null},
                      ${limit}, null, null, 'nombre')`;

        const first = await search(null, 101);
        expect(first).toHaveLength(100); // pedir 101 no sirve: la base topa en 100
        const last = first.at(-1)!;
        expect(last.title).toBe("Producto 100");
        const after = await search({ k: last.sort_key, id: last.id }, 1);
        expect(after.map((r) => r.title)).toEqual(["Producto 101"]);
        const end = await search({ k: after[0]!.sort_key, id: after[0]!.id }, 1);
        expect(end).toHaveLength(0);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
