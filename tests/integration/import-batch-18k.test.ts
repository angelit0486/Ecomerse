import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleKey, partBody, partsToSend, prepareImport } from "@/lib/imports/split";
import { createImportHandlers } from "@/server/imports/handlers";
import { readPartBody } from "@/server/imports/parts";
import { createPublishHandlers } from "@/server/imports/publish-handlers";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createLogger } from "@/server/observability/logger";

/**
 * ADR-064 opción A (Orden 10, mensaje 4), prueba obligatoria: 18,000 filas en 4
 * partes con una falla en la tercera. Camino real de punta a punta: el archivo se
 * parte con el módulo del navegador, cada parte pasa por el lector del servidor
 * y por imports_create_part (validación contra la base), el lote se aplica con
 * el worker de producción (system_worker) y la publicación corre por tandas.
 *
 *  - partes 1 y 2 aplicadas; la 3 revertida completa; la 4 pendiente;
 *  - corregir y repetir SOLO la parte 3 (las otras huellas no cambian);
 *  - sin productos ni variantes duplicados;
 *  - otra tienda no puede consultar ni modificar el lote;
 *  - el worker se cae a media parte y el lote se recupera;
 *  - concurrencia: misma parte dos veces, aplicar dos veces, tope por hora.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);

const log = createLogger({ sink: () => {} });

const DOOMED_WORKER = fileURLToPath(new URL("./support/doomed-worker.mjs", import.meta.url));

const PRODUCTS = 6000;
const SIZES = ["CH", "M", "G"] as const;
const ROWS = PRODUCTS * SIZES.length;
/** Cada 500 productos, precio 0: se importa, pero no se publica (queda pendiente). */
const ZERO_EVERY = 500;

let storeId = "";
let ownerId = "";
let otherStoreId = "";
let otherOwnerId = "";

async function org(slug: string, handle: string, email: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('batch_plan', 'batch_plan')
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

/** Como el panel: la sesión del usuario contra las RPC públicas (RLS y permisos reales). */
function asUser<T>(userId: string, work: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" })}, true),
                     set_config('role', 'authenticated', true)`;
    return work(sql);
  }) as Promise<T>;
}

/** Código del error de la base («not_found/import_batch»), como lo ve el servidor. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    const e = error as { message?: string; detail?: string };
    return e.detail ? `${e.message}/${e.detail}` : String(e.message);
  }
}

/** La hoja de ropa de 18,000 filas: 6,000 playeras en 3 tallas, todas «Publicado: sí». */
function sheet(fix?: { sku: string; to: string }) {
  const lines = ["Producto,Talla,Precio,Existencias,SKU,Publicado"];
  for (let i = 1; i <= PRODUCTS; i += 1) {
    for (const size of SIZES) {
      const sku = `PL-${i}-${size}`;
      lines.push(
        `Playera ${i},${size},${i % ZERO_EVERY === 0 ? "0" : "249.00"},${(i % 9) + 1},${fix?.sku === sku ? fix.to : sku},sí`,
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const fileFingerprint = (text: string) =>
  globalThis.crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(text))
    .then((d) => Buffer.from(d).toString("hex"));

async function run() {
  return runJobs({
    store,
    registry: new Map([
      ...createImportHandlers({ db: worker }),
      ...createPublishHandlers({ db: worker }),
    ]),
    workerId: "test-batch",
    log,
    deadlineMs: 150_000,
    hardDeadlineMs: 170_000,
  });
}

/** Corre la cola hasta vaciarla: partes del lote en orden y publicación por tandas. */
async function drain() {
  for (let i = 0; i < 40; i += 1) {
    const r = await run();
    if (r.succeeded + r.retried + r.deferred === 0) return;
  }
}

interface PartRow {
  id: string;
  part_number: number;
  status: string;
  error: string | null;
  committed_at: string | null;
}

async function liveParts(batchId: string): Promise<Map<number, PartRow>> {
  const rows = await admin<PartRow[]>`
    select distinct on (part_number) id, part_number, status, error, committed_at
      from public.import_jobs
     where batch_id = ${batchId} and status <> 'cancelled'
     order by part_number, (status <> 'failed') desc, created_at desc`;
  return new Map(rows.map((r) => [r.part_number, r]));
}

async function uploadPart(batchId: string, part: number, body: string) {
  const read = readPartBody(new TextEncoder().encode(body));
  if (!read.ok) throw new Error(`parte ${part}: ${read.code}`);
  return asUser(ownerId, async (sql) => {
    const [row] = await sql<{ r: { job_id: string; reused: boolean } }[]>`
      select public.imports_create_part(${storeId}, ${batchId}, ${part}, ${read.fingerprint},
               ${read.columns}::text[], ${read.ignored}::text[], ${sql.json(read.rows as never)}) as r`;
    return { ...row!.r, fingerprint: read.fingerprint };
  });
}

beforeAll(async () => {
  ({ storeId, ownerId } = await org("org-lote-a", "lote-a", "owner-lote@a.test"));
  ({ storeId: otherStoreId, ownerId: otherOwnerId } = await org(
    "org-lote-b",
    "lote-b",
    "owner-lote@b.test",
  ));
  await admin`delete from system.jobs`;
});
afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("ADR-064: 18,000 filas en 4 partes con una falla en la tercera", () => {
  let batchId = "";
  const evidence: Record<string, unknown> = {};

  it("parte el archivo en 4 partes sin separar productos y las valida contra la base", async () => {
    const csv = sheet();
    const prepared = prepareImport(csv);
    if (!prepared.ok) throw new Error(prepared.code);
    expect(prepared.rows).toBe(ROWS);
    expect(prepared.parts.map((p) => p.rows.length)).toEqual([4998, 4998, 4998, 3006]);
    // Ningún producto queda en dos partes.
    const owner = new Map<string, number>();
    prepared.parts.forEach((p, i) => {
      const at = p.headers.indexOf("handle");
      for (const r of p.rows) {
        const key = handleKey(r[at]);
        expect(owner.get(key) ?? i).toBe(i);
        owner.set(key, i);
      }
    });
    expect(owner.size).toBe(PRODUCTS);

    const bodies = prepared.parts.map(partBody);
    const fingerprints = bodies.map((b) => readPartBody(new TextEncoder().encode(b)));
    const created = await asUser(ownerId, async (sql) => {
      const [row] = await sql<{ r: { batch_id: string; resumed: boolean } }[]>`
        select public.imports_batch_create(${storeId}, 'ropa-18k.csv', 'upsert',
                 ${prepared.parts.map((p) => p.rows.length)}::int[],
                 ${fingerprints.map((f) => (f.ok ? f.fingerprint : ""))}::text[],
                 ${await fileFingerprint(csv)}) as r`;
      return row!.r;
    });
    expect(created.resumed).toBe(false);
    batchId = created.batch_id;

    const timings: number[] = [];
    for (const [i, body] of bodies.entries()) {
      const started = Date.now();
      const r = await uploadPart(batchId, i + 1, body);
      timings.push(Date.now() - started);
      expect(r.reused).toBe(false);
    }
    evidence.validate_ms_per_part = timings;
    const [batch] = await admin<{ status: string; total_rows: number }[]>`
      select status, total_rows from public.import_batches where id = ${batchId}`;
    expect(batch).toEqual({ status: "ready", total_rows: ROWS });
    const totals = await admin<{ part_number: number; errors: number; create: number }[]>`
      select part_number, (totals ->> 'errors')::int as errors, (totals ->> 'create')::int as create
        from public.import_jobs where batch_id = ${batchId} order by part_number`;
    expect(totals).toEqual([
      { part_number: 1, errors: 0, create: 1666 },
      { part_number: 2, errors: 0, create: 1666 },
      { part_number: 3, errors: 0, create: 1666 },
      { part_number: 4, errors: 0, create: 1002 },
    ]);
  }, 600_000);

  it("falla la parte 3 al aplicarse: 1 y 2 aplicadas, 3 revertida completa, 4 pendiente", async () => {
    // Entre la vista previa y la aplicación, alguien crea en el panel un producto
    // con el SKU de la ÚLTIMA fila de la parte 3: todas sus filas anteriores se
    // escribirían antes de fallar, así que la prueba demuestra el «todo o nada».
    await asUser(
      ownerId,
      (sql) =>
        sql`select public.catalog_upsert_product(${storeId}, ${sql.json({
          title: "Intruso",
          slug: "intruso",
          variants: [{ price: 100, sku: "PL-4998-G" }],
        })})`,
    );
    const commit = await asUser(ownerId, async (sql) => {
      const [row] = await sql<{ r: { status: string; replayed: boolean } }[]>`
        select public.imports_batch_commit(${storeId}, ${batchId}) as r`;
      return row!.r;
    });
    expect(commit).toEqual({ status: "running", replayed: false });

    const started = Date.now();
    await drain();
    evidence.apply_parts_1_2_and_fail_3_ms = Date.now() - started;

    const parts = await liveParts(batchId);
    expect([1, 2, 3, 4].map((p) => parts.get(p)?.status)).toEqual([
      "completed",
      "completed",
      "failed",
      "validated",
    ]);
    // La fila del error es la del archivo completo (row 14,995), no la de la parte.
    expect(parts.get(3)!.error).toMatch(/^Fila 14995: sku/);
    const [batch] = await admin<{ status: string; stop_reason: string }[]>`
      select status, stop_reason from public.import_batches where id = ${batchId}`;
    expect(batch!.status).toBe("stopped");
    expect(batch!.stop_reason).toMatch(/^La parte 3 no se pudo aplicar: Fila 14995/);

    const [counts] = await admin<
      { p12: number; v12: number; p3: number; m3: number; p4: number; active12: number }[]
    >`
      select count(*) filter (where n between 1 and 3332)::int as p12,
             (select count(*)::int from public.product_variants v join public.products p
                on p.store_id = v.store_id and p.id = v.product_id
               where p.store_id = ${storeId} and p.slug ~ '^playera-[0-9]+$'
                 and substring(p.slug from 9)::int <= 3332) as v12,
             count(*) filter (where n between 3333 and 4998)::int as p3,
             (select count(*)::int from public.inventory_movements
               where store_id = ${storeId} and reference_id = ${parts.get(3)!.id}) as m3,
             count(*) filter (where n > 4998)::int as p4,
             count(*) filter (where n between 1 and 3332 and status = 'active')::int as active12
        from (select substring(slug from 9)::int as n, status from public.products
               where store_id = ${storeId} and slug ~ '^playera-[0-9]+$') x`;
    expect(counts).toEqual({
      p12: 3332,
      v12: 9996,
      p3: 0,
      m3: 0,
      p4: 0,
      // 3,332 menos los de precio 0 (500, 1000, 1500, 2000, 2500, 3000).
      active12: 3326,
    });
  }, 900_000);

  it("corregir y repetir SOLO la parte 3; el worker se cae a media parte y se recupera", async () => {
    const before = await liveParts(batchId);
    // El comerciante corrige el SKU en su archivo y lo vuelve a elegir.
    const corrected = prepareImport(sheet({ sku: "PL-4998-G", to: "PL-4998-G2" }));
    if (!corrected.ok) throw new Error(corrected.code);
    const bodies = corrected.parts.map(partBody);
    const fingerprints = bodies.map((b) => {
      const r = readPartBody(new TextEncoder().encode(b));
      return r.ok ? r.fingerprint : "";
    });
    const live = await admin<
      { part: number; status: string; fingerprint: string; errors: number }[]
    >`
      select part_number as part, status, part_fingerprint as fingerprint, (totals ->> 'errors')::int as errors
        from public.import_jobs where id in ${admin([...before.values()].map((p) => p.id))}`;
    // Solo la parte 3 cambió (o falló): es la única que se sube.
    expect(partsToSend(fingerprints, live)).toEqual({ ok: true, parts: [3] });
    const again = await uploadPart(batchId, 3, bodies[2]!);
    expect(again.reused).toBe(false);
    expect(again.job_id).not.toBe(before.get(3)!.id);

    await asUser(ownerId, (sql) => sql`select public.imports_batch_commit(${storeId}, ${batchId})`);
    const p3 = (await liveParts(batchId)).get(3)!;
    expect(p3.status).toBe("committing");

    // Interrupción: el proceso del worker muere mientras aplica la parte 3.
    const [queued] = await admin<{ id: string }[]>`
      select id from system.jobs where dedupe_key = ${`import.commit:${p3.id}`}`;
    const child = spawn(
      process.execPath,
      [DOOMED_WORKER, process.env.TEST_WORKER_DATABASE_URL!, queued!.id],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    let backend = 0;
    for (let i = 0; i < 300 && backend === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const rows = await admin<{ pid: number }[]>`
        select pid from pg_stat_activity
         where usename = 'system_worker' and state = 'active' and query ilike '%system.import_commit%'`;
      backend = rows[0]?.pid ?? 0;
    }
    expect(backend).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1500)); // ya escribió parte de la parte 3
    child.kill("SIGKILL");
    await exited;
    // La base nota la conexión muerta al terminar la consulta; aquí se adelanta.
    await admin`select pg_terminate_backend(${backend})`;
    for (let i = 0; i < 100; i += 1) {
      const [alive] = await admin<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity where pid = ${backend}`;
      if (alive!.n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Nada de la parte 3 quedó escrito; el lote sigue «aplicando» esa parte.
    const [mid] = await admin<{ p3: number; status: string; part: string }[]>`
      select (select count(*)::int from public.products where store_id = ${storeId}
                and slug ~ '^playera-[0-9]+$' and substring(slug from 9)::int between 3333 and 4998) as p3,
             (select status from public.import_batches where id = ${batchId}) as status,
             (select status from public.import_jobs where id = ${p3.id}) as part`;
    expect(mid).toEqual({ p3: 0, status: "running", part: "committing" });
    // Como tras una caída real: el trabajo sigue tomado por el worker muerto.
    const [job] = await admin<{ status: string; attempts: number; locked_by: string }[]>`
      select status, attempts, locked_by from system.jobs where id = ${queued!.id}`;
    expect(job).toEqual({ status: "running", attempts: 1, locked_by: "test-crash" });
    // Pasa el tiempo del candado (5 min): la cola lo devuelve y otro worker lo retoma.
    await admin`update system.jobs set locked_at = now() - interval '10 minutes' where id = ${queued!.id}`;

    const started = Date.now();
    await drain();
    evidence.recover_and_apply_parts_3_4_ms = Date.now() - started;

    const after = await liveParts(batchId);
    expect([1, 2, 3, 4].map((p) => after.get(p)?.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    // Las partes 1 y 2 no se repitieron: mismas importaciones, misma hora de aplicación.
    for (const p of [1, 2]) {
      expect(after.get(p)!.id).toBe(before.get(p)!.id);
      expect(after.get(p)!.committed_at).toEqual(before.get(p)!.committed_at);
    }
    const [batch] = await admin<{ status: string }[]>`
      select status from public.import_batches where id = ${batchId}`;
    expect(batch!.status).toBe("completed");

    // Sin duplicados: 6,000 productos y 18,000 variantes, cada SKU una vez.
    const [dups] = await admin<
      { products: number; slugs: number; variants: number; skus: number; movements: number }[]
    >`
      select count(distinct p.id)::int as products, count(distinct p.slug)::int as slugs,
             count(v.id)::int as variants, count(distinct v.sku)::int as skus,
             (select count(*)::int from public.inventory_movements m
               where m.store_id = ${storeId} and m.reference_type = 'import'
                 and m.reference_id in (select id from public.import_jobs
                                         where batch_id = ${batchId} and status = 'completed')) as movements
        from public.products p
        join public.product_variants v on v.store_id = p.store_id and v.product_id = p.id
       where p.store_id = ${storeId} and p.slug ~ '^playera-[0-9]+$'`;
    expect(dups).toEqual({
      products: PRODUCTS,
      slugs: PRODUCTS,
      variants: ROWS,
      skus: ROWS,
      movements: ROWS,
    });

    // Publicación masiva: 5,988 publicados y 12 pendientes por precio 0, con el motivo.
    const [publish] = await admin<
      { candidates: number; published: number; blocked: number; price: number; active: number }[]
    >`
      select sum((r.totals ->> 'candidates')::int)::int as candidates,
             sum((r.totals ->> 'published')::int)::int as published,
             sum((r.totals ->> 'blocked')::int)::int as blocked,
             sum(coalesce((r.totals -> 'groups' ->> 'price')::int, 0))::int as price,
             (select count(*)::int from public.products where store_id = ${storeId}
                and slug ~ '^playera-[0-9]+$' and status = 'active') as active
        from public.publish_runs r
       where r.import_job_id in (select id from public.import_jobs where batch_id = ${batchId})`;
    expect(publish).toEqual({
      candidates: PRODUCTS,
      published: PRODUCTS - PRODUCTS / ZERO_EVERY,
      blocked: PRODUCTS / ZERO_EVERY,
      price: PRODUCTS / ZERO_EVERY,
      active: PRODUCTS - PRODUCTS / ZERO_EVERY,
    });
    evidence.publish = publish;
    const [audit] = await admin<{ n: number }[]>`
      select count(*)::int as n from audit.audit_logs
       where action = 'import.batch_completed' and entity_id = ${batchId}`;
    expect(audit!.n).toBe(1);
    // Evidencia para el informe (Orden 10, mensaje 4, punto 12): con LOTE_EVIDENCIA=<archivo>.
    if (process.env.LOTE_EVIDENCIA) {
      writeFileSync(process.env.LOTE_EVIDENCIA, `${JSON.stringify(evidence, null, 2)}\n`);
    }
  }, 900_000);

  it("otra tienda no puede consultar ni modificar el lote", async () => {
    const seen = await asUser(
      otherOwnerId,
      (sql) => sql<{ batches: number; parts: number }[]>`
        select (select count(*)::int from public.import_batches where id = ${batchId}) as batches,
               (select count(*)::int from public.import_jobs where batch_id = ${batchId}) as parts`,
    );
    expect(seen[0]).toEqual({ batches: 0, parts: 0 });
    // Haciendo pasar el lote por uno de su tienda: no existe para ella.
    expect(
      await dbError(
        asUser(
          otherOwnerId,
          (sql) => sql`select public.imports_batch_commit(${otherStoreId}, ${batchId})`,
        ),
      ),
    ).toBe("not_found/import_batch");
    // Con la tienda ajena: sin permiso.
    for (const call of [
      (sql: postgres.TransactionSql) =>
        sql`select public.imports_batch_cancel(${storeId}, ${batchId})`,
      (sql: postgres.TransactionSql) =>
        sql`select public.imports_batch_new_categories(${storeId}, ${batchId})`,
      (sql: postgres.TransactionSql) =>
        sql`select public.imports_create_part(${storeId}, ${batchId}, 1, ${"0".repeat(64)},
                                             array['handle'], '{}'::text[], '[]'::jsonb)`,
    ]) {
      expect(await dbError(asUser(otherOwnerId, call))).toBe("forbidden");
    }
  });
});

describe("ADR-064: idempotencia y topes bajo concurrencia", () => {
  async function smallBatch(name: string) {
    const lines = ["Producto,Precio,SKU"];
    for (let i = 1; i <= 6; i += 1) lines.push(`${name} ${i},10,${name.toUpperCase()}-${i}`);
    const prepared = prepareImport(lines.join("\n"));
    if (!prepared.ok) throw new Error(prepared.code);
    // Dos partes de 3 filas (como si fueran de 5,000).
    const half = {
      headers: prepared.parts[0]!.headers,
      ignored: [],
      rows: prepared.parts[0]!.rows.slice(0, 3),
      rowNumbers: prepared.parts[0]!.rowNumbers.slice(0, 3),
    };
    const rest = {
      ...half,
      rows: prepared.parts[0]!.rows.slice(3),
      rowNumbers: prepared.parts[0]!.rowNumbers.slice(3),
    };
    const bodies = [partBody(half), partBody(rest)];
    const fps = bodies.map((b) => {
      const r = readPartBody(new TextEncoder().encode(b));
      return r.ok ? r.fingerprint : "";
    });
    const id = await asUser(ownerId, async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        select (public.imports_batch_create(${storeId}, ${`${name}.csv`}, 'create_only', '{3,3}'::int[],
                  ${fps}::text[], ${await fileFingerprint(name)}) ->> 'batch_id') as id`;
      return row!.id;
    });
    return { id, bodies };
  }

  it("la misma parte subida dos veces a la vez: una importación, la otra la reutiliza", async () => {
    const { id, bodies } = await smallBatch("doble");
    const read = readPartBody(new TextEncoder().encode(bodies[0]!));
    if (!read.ok) throw new Error(read.code);
    const call = (pause: number) =>
      asUser(ownerId, async (sql) => {
        const startedAt = Date.now();
        const [row] = await sql<{ r: { job_id: string; reused: boolean } }[]>`
          select public.imports_create_part(${storeId}, ${id}, 1, ${read.fingerprint},
                   ${read.columns}::text[], '{}'::text[], ${sql.json(read.rows as never)}) as r`;
        if (pause) await sql`select pg_sleep(${pause})`;
        return { ...row!.r, startedAt, endedAt: Date.now() };
      });
    const first = call(1);
    await new Promise((r) => setTimeout(r, 300));
    const second = call(0);
    const [a, b] = await Promise.all([first, second]);
    // La segunda empezó mientras la primera seguía abierta y esperó su candado.
    expect(b.startedAt).toBeLessThan(a.endedAt);
    expect(b.endedAt).toBeGreaterThanOrEqual(a.endedAt - 50);
    expect(b.job_id).toBe(a.job_id);
    expect([a.reused, b.reused]).toEqual([false, true]);
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.import_jobs where batch_id = ${id} and part_number = 1`;
    expect(n!.n).toBe(1);
  });

  it("aplicar el lote dos veces a la vez empieza una sola parte, una sola vez", async () => {
    const { id, bodies } = await smallBatch("aplicar");
    for (const [i, body] of bodies.entries()) await uploadPart(id, i + 1, body);
    const commit = () =>
      asUser(ownerId, async (sql) => {
        const [row] = await sql<{ r: { status: string; replayed: boolean } }[]>`
          select public.imports_batch_commit(${storeId}, ${id}) as r`;
        await sql`select pg_sleep(0.5)`;
        return row!.r;
      });
    const results = await Promise.all([commit(), commit()]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    const parts = await liveParts(id);
    expect([parts.get(1)!.status, parts.get(2)!.status]).toEqual(["committing", "validated"]);
    const [q] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs where dedupe_key = ${`import.commit:${parts.get(1)!.id}`}`;
    expect(q!.n).toBe(1);
  });

  it("el tope de 30 importaciones por hora se cumple aunque dos partes lleguen a la vez", async () => {
    const { id, bodies } = await smallBatch("tope");
    await admin`
      insert into system.rate_limits (bucket, window_start, hits)
      values (${`imports:${storeId}`}, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 29)
      on conflict (bucket, window_start) do update set hits = 29`;
    const results = await Promise.all(
      bodies.map((body, i) =>
        dbError(uploadPart(id, i + 1, body)).then((r) => (r === "ok" ? "ok" : r.split("/")[0])),
      ),
    );
    expect(results.sort()).toEqual(["ok", "rate_limited"]);
    await admin`delete from system.rate_limits where bucket = ${`imports:${storeId}`}`;
  });
});
