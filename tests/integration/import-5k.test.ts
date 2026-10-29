import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createImportHandlers } from "@/server/imports/handlers";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createLogger } from "@/server/observability/logger";

/**
 * Importación de 5 000 filas TODO o NADA por el worker (GATE0 §26.1 paso 5 y
 * §38 F8: "5k filas atómicas"), contra PostgreSQL real con el rol system_worker.
 * Los planes se siembran por SQL (imports_create tiene su pgTAP); aquí se prueba
 * el job import.commit de punta a punta, con el mismo handler que en producción.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });
const ROWS = 5000;

let storeId = "";
let otherStoreId = "";
let ownerId = "";

async function tenant() {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('import_plan', 'import_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 20000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org 5k', 'org-import-5k', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda 5k', 'import-5k', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'owner-5k@import.test') returning id`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${u!.id}, 'org_owner')`;
  const [other] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda 5k B', 'import-5k-b', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  return { storeId: s!.id, otherStoreId: other!.id, ownerId: u!.id };
}

/** Un job confirmado de `ROWS` productos (una variante con existencias); `failAt` no se puede publicar. */
async function confirmedJob(prefix: string, failAt?: number, rows = ROWS) {
  const [job] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, commit_requested_by,
                                    commit_requested_at, columns, needs, totals)
    values (${storeId}, 'products', 'create_only', 'committing', ${`${prefix}.csv`}, ${ownerId}, ${ownerId}, now(),
            array['handle', 'title', 'status', 'sku', 'price', 'inventory_quantity'],
            array['imports.run', 'inventory.adjust', 'products.create', 'products.publish'],
            ${admin.json({ rows, products: rows, create: rows, update: 0, errors: 0 })})
    returning id`;
  await admin`
    insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors, action)
    select ${storeId}, ${job!.id}, g + 1, jsonb_build_object('handle', ${prefix} || '-' || g),
           jsonb_build_object('handle', ${prefix} || '-' || g, 'status', 'active', 'option_names', null,
             'product', jsonb_build_object('title', 'Producto ' || g),
             'variants', jsonb_build_array(jsonb_build_object(
               'row_number', g + 1, 'sku', upper(${prefix}) || '-' || g, 'quantity', 3,
               'price', case when g = ${failAt ?? -1} then 0 else 19900 end))),
           '[]'::jsonb, 'create'
      from generate_series(1, ${rows}) g`;
  await admin`select app.enqueue_job('import.commit', ${admin.json({ import_job_id: job!.id })}, ${storeId},
                                     ${`import.commit:${job!.id}`}, now(), 3)`;
  return job!.id;
}

async function run() {
  return runJobs({
    store,
    registry: new Map(createImportHandlers({ db: worker })),
    workerId: "test-5k",
    log,
    deadlineMs: 150_000,
    hardDeadlineMs: 170_000,
  });
}

beforeAll(async () => {
  ({ storeId, otherStoreId, ownerId } = await tenant());
});
beforeEach(async () => {
  await admin`delete from system.jobs`;
});
afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("import.commit con 5 000 filas", () => {
  it("aplica todo en una transacción: productos publicados y existencias como movimientos de importación", async () => {
    // Referencia de 1 000 filas para comprobar que el costo crece linealmente.
    await confirmedJob("ref", undefined, 1000);
    let started = Date.now();
    expect(await run()).toMatchObject({ succeeded: 1 });
    const reference = Date.now() - started;

    const jobId = await confirmedJob("ok");
    started = Date.now();
    expect(await run()).toMatchObject({ succeeded: 1 });
    const elapsed = Date.now() - started;
    const [job] = await admin<{ status: string; totals: { created: number } }[]>`
      select status, totals from public.import_jobs where id = ${jobId}`;
    expect(job).toMatchObject({ status: "completed", totals: { created: ROWS } });
    const [counts] = await admin<{ products: number; active: number; movements: number }[]>`
      select (select count(*)::int from public.products where store_id = ${storeId} and slug like 'ok-%') as products,
             (select count(*)::int from public.products where store_id = ${storeId} and slug like 'ok-%'
                                                         and status = 'active') as active,
             (select count(*)::int from public.inventory_movements where store_id = ${storeId}
                                                                   and reference_type = 'import'
                                                                   and reference_id = ${jobId}) as movements`;
    expect(counts).toEqual({ products: ROWS, active: ROWS, movements: ROWS });
    // Lineal (5× filas ≈ 5× tiempo; cuadrático sería ≈ 25×). En este equipo, 5 000
    // filas tardan 20–40 s: caben en una ejecución del runner (55 s en Vercel).
    expect(elapsed).toBeLessThan(reference * 8);
  }, 300_000);

  it("si la última fila falla no queda nada escrito y el error dice la fila", async () => {
    const jobId = await confirmedJob("mal", ROWS);
    expect(await run()).toMatchObject({ succeeded: 1 });
    const [job] = await admin<{ status: string; error: string }[]>`
      select status, error from public.import_jobs where id = ${jobId}`;
    expect(job).toEqual({
      status: "failed",
      error: `Fila ${ROWS + 1}: no se puede publicar (price_zero)`,
    });
    const [counts] = await admin<{ products: number; movements: number; audits: number }[]>`
      select (select count(*)::int from public.products where store_id = ${storeId} and slug like 'mal-%') as products,
             (select count(*)::int from public.inventory_movements where reference_id = ${jobId}) as movements,
             (select count(*)::int from audit.audit_logs where action = 'import.failed' and entity_id = ${jobId}) as audits`;
    expect(counts).toEqual({ products: 0, movements: 0, audits: 1 });
  }, 300_000);

  it("mientras importa, el panel de otra tienda de la organización sigue creando productos (G-M4)", async () => {
    const jobId = await confirmedJob("con", undefined, 2000);
    const running = run();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // Como el panel en Supabase: si el lote retuviera el candado de la organización,
    // esto esperaría hasta el final de la importación y cortaría por tiempo.
    const started = Date.now();
    const created = await admin.begin(async (sql) => {
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: ownerId,
        role: "authenticated",
        aal: "aal2",
      })}, true), set_config('role', 'authenticated', true), set_config('statement_timeout', '4000', true)`;
      const [row] = await sql<{ product: { id: string } }[]>`
        select public.catalog_upsert_product(${otherStoreId}, ${sql.json({
          title: "Concurrente",
          slug: "concurrente",
          variants: [{ price: 100 }],
        })}) as product`;
      return row!.product.id;
    });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(created).toMatch(/^[0-9a-f-]{36}$/);
    const [during] = await admin<
      { status: string }[]
    >`select status from public.import_jobs where id = ${jobId}`;
    expect(during!.status).toBe("committing"); // la importación seguía en curso
    expect(await running).toMatchObject({ succeeded: 1 });
    const [job] = await admin<
      { status: string }[]
    >`select status from public.import_jobs where id = ${jobId}`;
    expect(job!.status).toBe("completed");
  }, 300_000);

  it("la vista previa de 5 000 actualizaciones dice qué cambia y coincide con lo que se aplica (F3)", async () => {
    // Usa los 5 000 productos «ok-*» del primer caso (precio 19900, 3 piezas).
    const [job] = await admin<{ id: string }[]>`
      insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, columns, needs, totals)
      values (${storeId}, 'products', 'update_existing', 'validated', 'precios.csv', ${ownerId},
              array['handle', 'sku', 'price', 'inventory_quantity'], array['imports.run', 'inventory.adjust', 'products.update'],
              ${admin.json({ rows: ROWS, products: ROWS, create: 0, update: ROWS, errors: 0 })})
      returning id`;
    await admin`
      insert into public.import_job_rows (store_id, import_job_id, row_number, raw, normalized, errors, action)
      select ${storeId}, ${job!.id}, g + 1, jsonb_build_object('handle', 'ok-' || g),
             jsonb_build_object('handle', 'ok-' || g, 'option_names', null, 'product', '{}'::jsonb,
               'variants', jsonb_build_array(jsonb_build_object(
                 'row_number', g + 1, 'sku', 'OK-' || g, 'price', 21890,
                 'quantity', case when g <= 10 then 1 else 3 end))),
             '[]'::jsonb, 'update'
        from generate_series(1, ${ROWS}) g`;
    const preview = () =>
      admin.begin(async (sql) => {
        await sql`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: ownerId,
          role: "authenticated",
          aal: "aal2",
        })}, true), set_config('role', 'authenticated', true)`;
        const [row] = await sql<{ c: Record<string, unknown> }[]>`
          select public.import_preview_changes(${storeId}, ${job!.id}) as c`;
        return row!.c;
      });

    const started = Date.now();
    const before = await preview();
    // Con miles de productos el resumen no debe frenar la vista previa.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(before).toMatchObject({
      price_changes: ROWS,
      price_up: ROWS,
      price_down: 0,
      stock_changes: 10,
      unmatched_variants: 0,
    });
    expect((before.stock_examples as unknown[]).length).toBe(5);

    await admin`update public.import_jobs set status = 'committing', commit_requested_by = ${ownerId},
                       commit_requested_at = now() where id = ${job!.id}`;
    await admin`select app.enqueue_job('import.commit', ${admin.json({ import_job_id: job!.id })}, ${storeId},
                                       ${`import.commit:${job!.id}`}, now(), 3)`;
    expect(await run()).toMatchObject({ succeeded: 1 });
    // Lo que la vista previa anunció es exactamente lo que se aplicó: ya no queda nada por cambiar.
    expect(await preview()).toMatchObject({ price_changes: 0, stock_changes: 0 });
  }, 300_000);
});
