import { writeFileSync } from "node:fs";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { partBody, prepareImport } from "@/lib/imports/split";
import { createImportHandlers } from "@/server/imports/handlers";
import { readPartBody } from "@/server/imports/parts";
import { createPublishHandlers } from "@/server/imports/publish-handlers";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { DeferJobError, type JobHandler } from "@/server/jobs/types";
import { createLogger } from "@/server/observability/logger";

/**
 * A1 (auditoría del bloque 2, Orden 10, mensaje 5): el runner disparado cada
 * minuto, con los MISMOS límites que en Vercel (`runQueuedJobs`: 45 s de plazo,
 * 55 s de tope, un trabajo por reclamo, función de 60 s). Nadie tiene la página
 * abierta: solo «minutos» de cron, y en cada minuto DOS runners a la vez (una
 * pasada que se alarga se encima con la siguiente).
 *
 *  - un lote de 6,000 filas en 2 partes termina solo, con publicación;
 *  - cada parte se aplica UNA vez (un trabajo, un intento), sin duplicados;
 *  - ninguna pasada pasa de 60 s;
 *  - un trabajo que esperó 24 h se toma en el siguiente minuto y no se da por
 *    atascado mientras siga en la cola;
 *  - una tienda con mucha cola no bloquea a otra: orden de llegada. Un trabajo
 *    aplazado (sin tiempo) conserva su lugar y se retoma primero: la espera de
 *    otra tienda queda acotada a lo que dura UN trabajo (≤ 5,000 filas o
 *    productos), no es indefinida.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });

/** Los límites de producción (src/server/jobs/run-now.ts). */
const PRODUCTION = { deadlineMs: 45_000, hardDeadlineMs: 55_000, batchSize: 1 } as const;
const FUNCTION_LIMIT_MS = 60_000;

let storeA = "";
let storeB = "";
let ownerA = "";

async function org(slug: string, handle: string, email: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('cadence_plan', 'cadence_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 10), (${plan!.id}, 'max_products', 20000)
              on conflict (plan_id, key) do update set value_int = excluded.value_int`;
  const [o] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values (${slug}, ${slug}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${o!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${o!.id}, ${handle}, ${handle}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  const [u] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${o!.id}, ${u!.id}, 'org_owner')`;
  return { storeId: s!.id, ownerId: u!.id };
}

function asUser<T>(userId: string, work: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" })}, true),
                     set_config('role', 'authenticated', true)`;
    return work(sql);
  }) as Promise<T>;
}

const sha256 = (text: string) =>
  globalThis.crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(text))
    .then((d) => Buffer.from(d).toString("hex"));

/** Un «minuto» de cron: dos runners de producción a la vez, sin página abierta. */
async function minute(registry: Map<string, JobHandler>) {
  const started = Date.now();
  const results = await Promise.all(
    ["cron-a", "cron-b"].map((workerId) =>
      runJobs({ store, registry, workerId, log, ...PRODUCTION }),
    ),
  );
  return { ms: Date.now() - started, results };
}

beforeAll(async () => {
  ({ storeId: storeA, ownerId: ownerA } = await org("org-cad-a", "cad-a", "owner@cad-a.test"));
  ({ storeId: storeB } = await org("org-cad-b", "cad-b", "owner@cad-b.test"));
  await admin`delete from system.jobs`;
});
afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("A1: el runner cada minuto, con los límites de producción", () => {
  it("un lote de 6,000 filas en 2 partes termina solo, con la página cerrada, sin duplicar nada", async () => {
    const lines = ["Producto,Talla,Precio,Existencias,SKU,Publicado"];
    for (let i = 1; i <= 2000; i += 1) {
      for (const size of ["CH", "M", "G"])
        lines.push(`Sudadera ${i},${size},499.00,4,SD-${i}-${size},sí`);
    }
    const csv = lines.join("\n");
    const prepared = prepareImport(csv);
    if (!prepared.ok) throw new Error(prepared.code);
    expect(prepared.parts.map((p) => p.rows.length)).toEqual([4998, 1002]);
    const reads = prepared.parts.map((p) => {
      const r = readPartBody(new TextEncoder().encode(partBody(p)));
      if (!r.ok) throw new Error(r.code);
      return r;
    });
    const batchId = await asUser(ownerA, async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        select (public.imports_batch_create(${storeA}, 'sudaderas.csv', 'create_only',
                  ${prepared.parts.map((p) => p.rows.length)}::int[], ${reads.map((r) => r.fingerprint)}::text[],
                  ${await sha256(csv)}) ->> 'batch_id') as id`;
      return row!.id;
    });
    for (const [i, r] of reads.entries()) {
      await asUser(
        ownerA,
        (
          sql,
        ) => sql`select public.imports_create_part(${storeA}, ${batchId}, ${i + 1}, ${r.fingerprint},
                       ${r.columns}::text[], ${r.ignored}::text[], ${sql.json(r.rows as never)})`,
      );
    }
    await asUser(ownerA, (sql) => sql`select public.imports_batch_commit(${storeA}, ${batchId})`);

    const registry = new Map<string, JobHandler>([
      ...createImportHandlers({ db: worker }),
      ...createPublishHandlers({ db: worker }),
    ]);
    const minutes: number[] = [];
    for (let m = 0; m < 30; m += 1) {
      const tick = await minute(registry);
      minutes.push(tick.ms);
      const [state] = await admin<{ batch: string; open: number; runs: number }[]>`
        select (select status from public.import_batches where id = ${batchId}) as batch,
               (select count(*)::int from system.jobs where status in ('queued', 'running')) as open,
               (select count(*)::int from public.publish_runs r join public.import_jobs j on j.id = r.import_job_id
                 where j.batch_id = ${batchId} and r.status = 'completed') as runs`;
      if (state!.batch === "completed" && state!.open === 0 && state!.runs === 2) break;
    }
    // Ningún minuto pasa del límite de la función.
    expect(Math.max(...minutes)).toBeLessThan(FUNCTION_LIMIT_MS);
    const [batch] = await admin<{ status: string }[]>`
      select status from public.import_batches where id = ${batchId}`;
    expect(batch!.status).toBe("completed");
    // Cada parte, un solo trabajo y un solo intento: dos runners a la vez no la repitieron.
    const commits = await admin<{ attempts: number; status: string }[]>`
      select q.attempts, q.status from system.jobs q
       where q.type = 'import.commit'
         and (q.payload ->> 'import_job_id')::uuid in (select id from public.import_jobs where batch_id = ${batchId})`;
    expect(commits).toEqual([
      { attempts: 1, status: "succeeded" },
      { attempts: 1, status: "succeeded" },
    ]);
    const [counts] = await admin<
      { products: number; variants: number; skus: number; active: number }[]
    >`
      select count(distinct p.id)::int as products, count(v.id)::int as variants, count(distinct v.sku)::int as skus,
             count(distinct p.id) filter (where p.status = 'active')::int as active
        from public.products p join public.product_variants v on v.store_id = p.store_id and v.product_id = p.id
       where p.store_id = ${storeA} and p.slug like 'sudadera-%'`;
    expect(counts).toEqual({ products: 2000, variants: 6000, skus: 6000, active: 2000 });
    if (process.env.CADENCIA_EVIDENCIA) {
      writeFileSync(
        process.env.CADENCIA_EVIDENCIA,
        `${JSON.stringify({ minutes: minutes.length, ms: minutes, max: Math.max(...minutes) }, null, 2)}\n`,
      );
    }
  }, 1_800_000);

  it("una parte que espera la cola 24 h no se da por atascada; el siguiente minuto la toma", async () => {
    // Restos de otras pruebas en esta base: se limpian antes de medir.
    await worker`select system.fail_stuck_imports()`;
    const [imp] = await admin<{ id: string }[]>`
      insert into public.import_jobs (store_id, type, mode, status, file_name, requested_by, commit_requested_by,
                                      commit_requested_at, columns, needs, totals)
      values (${storeA}, 'products', 'create_only', 'committing', 'espera.csv', ${ownerA}, ${ownerA},
              now() - interval '24 hours', array['handle', 'title', 'price'], array['imports.run'],
              ${admin.json({ rows: 0, products: 0, create: 0, update: 0, errors: 0 })})
      returning id`;
    await admin`select app.enqueue_job('import.commit', ${admin.json({ import_job_id: imp!.id })}, ${storeA},
                                       ${`import.commit:${imp!.id}`}, now() - interval '24 hours', 3)`;
    // Mientras su trabajo siga en la cola, el mantenimiento no la da por atascada.
    const [swept] = await worker<{ n: number }[]>`select system.fail_stuck_imports() as n`;
    expect(swept!.n).toBe(0);
    const seen: string[] = [];
    const registry = new Map<string, JobHandler>([
      ["import.commit", async (j) => void seen.push(String(j.payload.import_job_id))],
    ]);
    await minute(registry);
    expect(seen).toEqual([imp!.id]);
    const [row] = await admin<{ status: string; attempts: number }[]>`
      select status, attempts from system.jobs where dedupe_key = ${`import.commit:${imp!.id}`}`;
    expect(row).toEqual({ status: "succeeded", attempts: 1 });
    await admin`update public.import_jobs set status = 'cancelled' where id = ${imp!.id}`;
  });

  it("una tienda con mucha cola no bloquea a otra: orden de llegada; lo aplazado conserva su lugar", async () => {
    await admin`delete from system.jobs`;
    // 20 trabajos viejos de A, uno de B, 5 más nuevos de A; el 3.º de A se aplaza una vez.
    const enqueue = (storeId: string, label: string, secondsAgo: number) =>
      admin`select app.enqueue_job('test.trabajo', ${admin.json({ label })}, ${storeId}, null,
                                   now() - make_interval(secs => ${secondsAgo}), 3)`;
    for (let i = 1; i <= 20; i += 1) await enqueue(storeA, `A${i}`, 1000 - i);
    await enqueue(storeB, "B1", 500);
    for (let i = 21; i <= 25; i += 1) await enqueue(storeA, `A${i}`, 400 - i);
    const order: string[] = [];
    let deferred = false;
    const registry = new Map<string, JobHandler>([
      [
        "test.trabajo",
        async (j) => {
          const label = (j.payload as { label: string }).label;
          if (label === "A3" && !deferred) {
            deferred = true;
            throw new DeferJobError("sin tiempo");
          }
          order.push(label);
        },
      ],
    ]);
    for (let m = 0; m < 5 && order.length < 26; m += 1) await minute(registry);
    expect(order).toHaveLength(26);
    // B1 no espera a los que llegaron después que él, aunque sean de una tienda con mucha cola.
    expect(order.indexOf("B1")).toBeLessThan(order.indexOf("A21"));
    // Lo aplazado conserva su lugar (system.release_job no cambia su hora): se
    // retoma antes que lo que llegó después, sin perder el turno ni un intento.
    expect(order.indexOf("A3")).toBeLessThan(order.indexOf("B1"));
    const [a3] = await admin<{ attempts: number }[]>`
      select attempts from system.jobs where payload ->> 'label' = 'A3'`;
    expect(a3!.attempts).toBe(1);
    const [left] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs where status <> 'succeeded'`;
    expect(left!.n).toBe(0);
  });
});
