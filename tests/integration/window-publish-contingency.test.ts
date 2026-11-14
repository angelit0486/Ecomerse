import { readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPublishHandlers } from "@/server/imports/publish-handlers";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import type { JobHandler } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

/**
 * A2 (Orden 10, mensaje 5): la ventana entre migrar y desplegar, de punta a punta.
 *
 *  1. Migraciones aplicadas, código ANTERIOR desplegado: su registro no conoce
 *     `catalog.publish_run` y el runner descarta el trabajo (`unknown_job_type`).
 *  2. El mantenimiento retoma la corrida 3 veces; a la 4.ª queda fallida con el
 *     motivo. Nada se publicó: los productos siguen en borrador.
 *  3. Con el código NUEVO desplegado, el guion de contingencia
 *     scripts/ops/ventana/03-retomar-publicaciones.sql la vuelve a encolar y el
 *     runner nuevo la publica pasando por las reglas (el de precio 0 no).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });

let storeId = "";
let ownerId = "";
let runId = "";
let windowStart = "";

const run = (registry: Map<string, JobHandler>) =>
  runJobs({
    store,
    registry,
    workerId: "ventana",
    log,
    deadlineMs: 45_000,
    hardDeadlineMs: 55_000,
  });

/** Pasa el tiempo (15 min) y corre la limpieza de mantenimiento. */
async function sweep() {
  await admin`alter table public.publish_runs disable trigger publish_runs_set_updated_at`;
  await admin`update public.publish_runs set updated_at = now() - interval '20 minutes' where id = ${runId}`;
  await admin`alter table public.publish_runs enable trigger publish_runs_set_updated_at`;
  await worker`select system.fail_stuck_imports()`;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ventana_plan', 'ventana_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 100)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [o] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Ventana', 'org-ventana', 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${o!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${o!.id}, 'Ventana', 'ventana', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), 'owner@ventana.test') returning id`;
  await admin`insert into public.organization_members (organization_id, user_id, role) values (${o!.id}, ${u!.id}, 'org_owner')`;
  storeId = s!.id;
  ownerId = u!.id;
  await admin`delete from system.jobs`;
  const [started] = await admin<{ now: string }[]>`select now()::text as now`;
  windowStart = started!.now;

  // Una importación aplicada con dos productos que pidieron publicarse.
  const products = await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true),
                     set_config('role', 'authenticated', true)`;
    const ids: string[] = [];
    for (const [slug, price] of [
      ["vela", 15000],
      ["vela-gratis", 0],
    ] as const) {
      const [row] = await sql<{ p: { id: string } }[]>`
        select public.catalog_upsert_product(${storeId}, ${sql.json({ title: slug, slug, variants: [{ price, sku: slug.toUpperCase() }] })}) as p`;
      ids.push(row!.p.id);
    }
    return ids;
  });
  const [job] = await admin<{ id: string }[]>`
    insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, commit_requested_by,
                                    commit_requested_at, columns, needs, totals)
    values (${storeId}, 'products', 'create_only', 'completed', 'velas.csv', ${ownerId}, ${ownerId}, now(),
            array['handle', 'title', 'price', 'status'], array['imports.run'],
            ${admin.json({ rows: 2, products: 2, create: 2, update: 0, errors: 0 })})
    returning id`;
  const [r] = await admin<{ id: string }[]>`
    insert into public.publish_runs (store_id, import_job_id, requested_by, status)
    values (${storeId}, ${job!.id}, ${ownerId}, 'queued') returning id`;
  runId = r!.id;
  for (const p of products) {
    await admin`insert into public.publish_run_items (store_id, run_id, product_id) values (${storeId}, ${runId}, ${p})`;
  }
  await admin`select app.enqueue_job('catalog.publish_run', ${admin.json({ run_id: runId })}, ${storeId},
                                     ${`catalog.publish_run:${runId}`}, now(), 5)`;
});
afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("A2: ventana entre migrar y desplegar", () => {
  it("con el código anterior la corrida no publica nada y termina fallida con el motivo", async () => {
    const oldCode = new Map<string, JobHandler>(); // el registro de 88edc6d no tiene catalog.publish_run
    expect(await run(oldCode)).toMatchObject({ dead: 1 });
    for (let resume = 1; resume <= 3; resume += 1) {
      await sweep();
      const [state] = await admin<{ resumes: number; status: string }[]>`
        select resumes, status from public.publish_runs where id = ${runId}`;
      expect(state).toEqual({ resumes: resume, status: "queued" });
      expect(await run(oldCode)).toMatchObject({ dead: 1 });
    }
    await sweep();
    const [failed] = await admin<{ status: string; error: string }[]>`
      select status, error from public.publish_runs where id = ${runId}`;
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toMatch(/^La publicación no terminó después de varios intentos/);
    const drafts = await admin<{ status: string }[]>`
      select status from public.products where store_id = ${storeId}`;
    expect(drafts.every((p) => p.status === "draft")).toBe(true);
    const [dead] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs where last_error = 'unknown_job_type'`;
    expect(dead!.n).toBe(4);
  });

  it("con el código nuevo, la contingencia la retoma y publica solo lo que cumple", async () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/ops/ventana/03-retomar-publicaciones.sql"),
      "utf8",
    ).replaceAll(":INICIO_VENTANA", windowStart);
    const requeued = await admin.unsafe<{ trabajo: string }[]>(script);
    expect(requeued).toHaveLength(1);
    // Correrla dos veces no duplica el trabajo.
    await admin.unsafe(script);
    const [jobs] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs where dedupe_key = ${`catalog.publish_run:${runId}:ventana`}`;
    expect(jobs!.n).toBe(1);

    const newCode = new Map<string, JobHandler>(createPublishHandlers({ db: worker }));
    expect(await run(newCode)).toMatchObject({ succeeded: 1, dead: 0 });
    const [done] = await admin<{ status: string; published: number; blocked: number }[]>`
      select status, (totals ->> 'published')::int as published, (totals ->> 'blocked')::int as blocked
        from public.publish_runs where id = ${runId}`;
    expect(done).toEqual({ status: "completed", published: 1, blocked: 1 });
    const products = await admin<{ slug: string; status: string }[]>`
      select slug, status from public.products where store_id = ${storeId} order by slug`;
    expect(products).toEqual([
      { slug: "vela", status: "active" },
      { slug: "vela-gratis", status: "draft" },
    ]);
  });
});
