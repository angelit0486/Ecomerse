import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * ADR-065 (Orden 10, mensaje 4): dos importaciones de la misma tienda que crean
 * la MISMA categoría nueva se aplican al mismo tiempo. La primera la crea; la
 * segunda espera al índice único de la dirección, ve la que ya existe y la usa.
 * Resultado: una sola categoría y las dos importaciones aplicadas. Contra
 * PostgreSQL real, con dos conexiones del rol system_worker.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const w1 = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
const w2 = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});

let storeId = "";
let otherStoreId = "";
let ownerId = "";

async function tenant() {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('cat_conc_plan', 'cat_conc_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 1000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org cat', 'org-cat-concurrency', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda cat', 'cat-concurrency', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [other] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda cat B', 'cat-concurrency-b', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'owner-cat@import.test') returning id`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${u!.id}, 'org_owner')`;
  return { storeId: s!.id, otherStoreId: other!.id, ownerId: u!.id };
}

/** Una importación confirmada de `n` productos con la categoría nueva aceptada. */
async function confirmedJob(prefix: string, n: number) {
  const [job] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, commit_requested_by,
                                    commit_requested_at, columns, needs, totals, new_categories)
    values (${storeId}, 'products', 'create_only', 'committing', ${`${prefix}.csv`}, ${ownerId}, ${ownerId}, now(),
            array['handle', 'title', 'sku', 'price', 'categories'],
            array['categories.manage', 'imports.run', 'products.create'],
            ${admin.json({ rows: n, products: n, create: n, update: 0, errors: 0 })},
            array['Concurrente'])
    returning id`;
  await admin`
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors, action)
    select ${storeId}, ${job!.id}, g + 1, jsonb_build_object('handle', ${prefix} || '-' || g),
           jsonb_build_object('handle', ${prefix} || '-' || g, 'option_names', null,
             'product', jsonb_build_object('title', 'Producto ' || g),
             'categories', jsonb_build_array('Concurrente'),
             'variants', jsonb_build_array(jsonb_build_object(
               'row_number', g + 1, 'sku', upper(${prefix}) || '-' || g, 'price', 19900))),
           '[]'::jsonb, 'create'
      from generate_series(1, ${n}) g`;
  return job!.id;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  ({ storeId, otherStoreId, ownerId } = await tenant());
});
afterAll(async () => {
  await Promise.all([admin.end(), w1.end(), w2.end()]);
});

describe("ADR-065: categorías nuevas con importaciones simultáneas", () => {
  it("dos importaciones crean la misma categoría a la vez: queda una y ambas se aplican", async () => {
    const a = await confirmedJob("con-a", 50);
    const b = await confirmedJob("con-b", 50);
    type Result = { status: string; categories_created: number };
    let firstCommittedAt = 0;
    let secondStartedAt = 0;
    let secondEndedAt = 0;
    const [ra, rb] = await Promise.all([
      // La primera retiene su transacción un momento después de crear la categoría…
      (async () => {
        const r = await w1.begin(async (tx) => {
          const [row] = await tx<{ r: Result }[]>`select system.import_commit(${a}) as r`;
          await tx`select pg_sleep(1.5)`;
          return row!.r;
        });
        firstCommittedAt = Date.now();
        return r;
      })(),
      // …y la segunda empieza mientras tanto: espera al índice único y usa la existente.
      (async () => {
        await sleep(400);
        secondStartedAt = Date.now();
        const r = await w2.begin(async (tx) => {
          const [row] = await tx<{ r: Result }[]>`select system.import_commit(${b}) as r`;
          return row!.r;
        });
        secondEndedAt = Date.now();
        return r;
      })(),
    ]);
    expect(ra).toMatchObject({ status: "completed", categories_created: 1 });
    expect(rb).toMatchObject({ status: "completed", categories_created: 0 });
    // La segunda empezó con la primera abierta y no pudo terminar antes de que la
    // primera confirmara: de verdad esperó al índice único (no corrió después).
    expect(secondStartedAt).toBeLessThan(firstCommittedAt);
    expect(secondEndedAt).toBeGreaterThanOrEqual(firstCommittedAt - 50);

    const [counts] = await admin<{ categories: number; linked: number; other: number }[]>`
      select (select count(*)::int from public.categories
               where store_id = ${storeId} and name = 'Concurrente' and deleted_at is null) as categories,
             (select count(*)::int from public.product_categories pc
                join public.categories c on c.store_id = pc.store_id and c.id = pc.category_id
               where pc.store_id = ${storeId} and c.name = 'Concurrente') as linked,
             (select count(*)::int from public.categories
               where store_id = ${otherStoreId} and name = 'Concurrente') as other`;
    expect(counts).toEqual({ categories: 1, linked: 100, other: 0 });
  }, 60_000);
});
