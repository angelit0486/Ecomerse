import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/csv-parse";
import { translatePlatformCsv } from "@/lib/imports/platforms";
import { createImportHandlers } from "@/server/imports/handlers";
import { checkHeaders, MAX_IMPORT_ROWS, planProductImport } from "@/server/imports/products";
import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createLogger } from "@/server/observability/logger";

/**
 * T04 (Orden 06): importar 10 000 productos con fallas y reintentos, por el
 * MISMO camino que el panel: CSV → lector → plan → `imports_create` (como la
 * dueña, RLS activo) → `imports_commit` → job `import.commit` con el rol
 * system_worker. Solo contra una base local desechable (scripts/capacity/t04.sh).
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 3, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const jobStore = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });
const HEADERS = "handle,title,status,brand,categories,sku,price,inventory_quantity";
const timings: Record<string, number> = {};

let storeId = "";
let ownerId = "";

/** CSV de `count` productos; `mutate` permite estropear filas a propósito. */
function csv(
  prefix: string,
  count: number,
  mutate: (n: number, row: string[]) => string[] = (_n, row) => row,
  price = (n: number) => 99 + (n % 400),
) {
  const lines = [HEADERS];
  for (let n = 1; n <= count; n += 1) {
    const row = [
      `${prefix}-${n}`,
      `Producto ${prefix} ${n}`,
      "active",
      `Marca ${1 + (n % 20)}`,
      `Ropa > Ropa ${1 + (n % 5)}`,
      `${prefix.toUpperCase()}-${n}`,
      `${price(n)}.00`,
      String(n % 50),
    ];
    lines.push(mutate(n, row).join(","));
  }
  return lines.join("\n");
}

function plan(text: string) {
  const parsed = parseCsv(text);
  const source = translatePlatformCsv(parsed.headers, parsed.rows, parsed.rowNumbers);
  const headers = checkHeaders(source.headers);
  if (!headers.ok) throw new Error("encabezados");
  return {
    columns: headers.columns,
    ignored: [...new Set([...source.ignored, ...headers.ignored])],
    rows: planProductImport(source.headers, source.rows, source.rowNumbers),
  };
}

/** Como el panel: sesión de la dueña con RLS activo. */
function asOwner<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({
      sub: ownerId,
      role: "authenticated",
      aal: "aal2",
    })}, true), set_config('role', 'authenticated', true)`;
    return fn(sql);
  }) as Promise<T>;
}

async function upload(name: string, text: string, mode = "create_only") {
  const p = plan(text);
  const started = Date.now();
  const jobId = await asOwner(async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      select public.imports_create(${storeId}, ${mode}, ${name}, ${p.columns}, ${p.ignored}, ${sql.json(
        p.rows as never,
      )}) as id`;
    return row!.id;
  });
  timings[`subir:${name}`] = Date.now() - started;
  const [job] = await admin<{ status: string; totals: Record<string, number> }[]>`
    select status, totals from public.import_jobs where id = ${jobId}`;
  return { jobId, ...job! };
}

function commit(jobId: string, skipErrors = false) {
  return asOwner(async (sql) => {
    const [row] = await sql<{ r: { status: string; replayed: boolean } }[]>`
      select public.imports_commit(${storeId}, ${jobId}, ${skipErrors}) as r`;
    return row!.r;
  });
}

async function run(label: string) {
  const started = Date.now();
  const result = await runJobs({
    store: jobStore,
    registry: new Map(createImportHandlers({ db: worker })),
    workerId: "t04",
    log,
    deadlineMs: 170_000,
    hardDeadlineMs: 190_000,
  });
  timings[`aplicar:${label}`] = Date.now() - started;
  return result;
}

async function counts(prefix: string) {
  const [row] = await admin<{ products: number; variants: number; movements: number }[]>`
    select (select count(*)::int from public.products where store_id = ${storeId} and slug like ${`${prefix}-%`}) as products,
           (select count(*)::int from public.product_variants where store_id = ${storeId}
                                                                and sku like ${`${prefix.toUpperCase()}-%`}) as variants,
           (select count(*)::int from public.inventory_movements m
              join public.inventory_levels l on l.id = m.level_id
              join public.product_variants v on v.id = l.variant_id
             where m.store_id = ${storeId} and v.sku like ${`${prefix.toUpperCase()}-%`}) as movements`;
  return row!;
}

const jobStatus = async (jobId: string) =>
  (
    await admin<{ status: string; error: string | null; totals: Record<string, number> }[]>`
      select status, error, totals from public.import_jobs where id = ${jobId}`
  )[0]!;

beforeAll(async () => {
  // Tienda vacía con plan de capacidad (generador sintético, índice 900).
  const [row] = await admin<{ store: string; owner: string }[]>`
    select capgen.store(900, 0) as store, capgen.user_id(900, 'owner') as owner`;
  storeId = row!.store;
  ownerId = row!.owner;
});
afterAll(async () => {
  console.log(`T04 tiempos (ms): ${JSON.stringify(timings)}`);
  await Promise.all([admin.end(), worker.end()]);
});

describe("T04: importación de 10 000 productos con fallas y reintentos", () => {
  it("columnas equivocadas: sin `handle` no pasa; las desconocidas se ignoran y se avisan", () => {
    expect(checkHeaders(["titulo", "precio"])).toMatchObject({ ok: false });
    expect(checkHeaders(["handle", "title", "handle"])).toMatchObject({ ok: false });
    const p = plan(`handle,title,columna_rara,price\nx-1,Equis,algo,10.00`);
    expect(p.ignored).toContain("columna_rara");
    expect(p.columns).toEqual(["handle", "title", "price"]);
  });

  it("más de 5 000 filas: lo rechazan el servidor y la base", async () => {
    const p = plan(csv("big", MAX_IMPORT_ROWS + 1));
    expect(p.rows.length).toBe(MAX_IMPORT_ROWS + 1);
    await expect(
      asOwner(
        (sql) =>
          sql`select public.imports_create(${storeId}, 'create_only', 'grande.csv', ${p.columns}, ${[]}::text[], ${sql.json(
            p.rows as never,
          )})`,
      ),
    ).rejects.toMatchObject({ message: "validation_failed", detail: "too_many_rows" });
    expect((await counts("big")).products).toBe(0);
  }, 120_000);

  let badHandles = 0;
  it("archivo 1 (5 000) con filas inválidas y SKU repetidos: no se confirma tal cual; con «importar las buenas» entra solo lo válido", async () => {
    const text = csv("a", 5000, (n, row) => {
      if (n % 125 === 0) row[6] = "abc"; // 40 precios ilegibles
      if (n % 170 === 0) row[1] = ""; // 29 sin título
      if (n % 200 === 1 && n > 1) row[5] = "A-1"; // 24 con el SKU del primero
      return row;
    });
    const job = await upload("archivo-1.csv", text);
    expect(job.status).toBe("validated");
    expect(job.totals.errors).toBeGreaterThan(0);
    await expect(commit(job.jobId)).rejects.toMatchObject({ detail: "import_not_ready" });
    expect((await counts("a")).products).toBe(0);

    expect(await commit(job.jobId, true)).toMatchObject({ status: "committing", replayed: false });
    expect(await run("archivo-1")).toMatchObject({ succeeded: 1 });
    const done = await jobStatus(job.jobId);
    expect(done.status).toBe("completed");
    const [bad] = await admin<{ n: number; with_product: number }[]>`
      select count(distinct lower(r.raw ->> 'handle'))::int as n,
             count(distinct p.id)::int as with_product
        from public.import_job_rows r
        left join public.products p on p.store_id = r.store_id and p.slug = lower(r.raw ->> 'handle')
       where r.import_job_id = ${job.jobId} and jsonb_array_length(r.errors) > 0`;
    badHandles = bad!.n;
    expect(badHandles).toBeGreaterThanOrEqual(69);
    // Ningún producto a medias: los que tenían error no existen.
    expect(bad!.with_product).toBe(0);
    const c = await counts("a");
    expect(c.products).toBe(5000 - badHandles);
    expect(c.variants).toBe(c.products);
    // Un solo SKU «A-1»: los repetidos no entraron.
    const [dup] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.product_variants where store_id = ${storeId} and sku = 'A-1'`;
    expect(dup!.n).toBe(1);
  }, 400_000);

  let fileTwo = "";
  it("archivo 2 (5 000): se interrumpe a media importación → no queda nada; el reintento la completa sin duplicar", async () => {
    const job = await upload("archivo-2.csv", csv("b", 5000));
    fileTwo = job.jobId;
    expect(job.totals.errors).toBe(0);
    await commit(job.jobId);

    const running = run("archivo-2-interrumpida");
    await new Promise((resolve) => setTimeout(resolve, 4000));
    // Se cancela la sentencia en curso (lo mismo que hace el límite de tiempo del
    // runner). Con `pg_terminate_backend` (conexión cortada) el resultado en la base
    // fue idéntico —nada escrito, job de vuelta en la cola—, pero el controlador
    // `postgres` lanza un TypeError suelto que tumba la corrida de pruebas (CAP-06).
    const killed = await admin<{ ok: boolean }[]>`
      select pg_cancel_backend(pid) as ok from pg_stat_activity
       where usename = 'system_worker' and datname = current_database() and state <> 'idle'`;
    expect(killed.length).toBeGreaterThan(0);
    const first = await running.catch((error: unknown) => ({ error }));
    expect(first).not.toMatchObject({ succeeded: 1 });
    expect(await counts("b")).toEqual({ products: 0, variants: 0, movements: 0 });
    expect((await jobStatus(job.jobId)).status).toBe("committing");

    // El reintento del runner espera su turno; aquí se adelanta para no dormir la prueba.
    await admin`update system.jobs set run_after = now(), locked_at = null, locked_by = null, status = 'queued'
                 where dedupe_key = ${`import.commit:${job.jobId}`} and status in ('queued', 'running')`;
    expect(await run("archivo-2-reintento")).toMatchObject({ succeeded: 1 });
    expect((await jobStatus(job.jobId)).status).toBe("completed");
    const c = await counts("b");
    expect(c.products).toBe(5000);
    expect(c.variants).toBe(5000);
    // Existencias: un movimiento por variante con cantidad > 0 (4 900), ni uno de más.
    expect(c.movements).toBe(4900);
  }, 600_000);

  it("confirmar dos veces o subir el mismo archivo otra vez no duplica nada", async () => {
    expect(await commit(fileTwo)).toMatchObject({ status: "completed", replayed: true });
    const [queued] = await admin<{ n: number }[]>`
      select count(*)::int as n from system.jobs where dedupe_key = ${`import.commit:${fileTwo}`}
                                                    and status in ('queued', 'running')`;
    expect(queued!.n).toBe(0);

    const again = await upload("archivo-2-otra-vez.csv", csv("b", 5000));
    expect(again.totals.errors).toBeGreaterThanOrEqual(5000);
    await expect(commit(again.jobId, true)).rejects.toMatchObject({
      detail: "import_nothing_valid",
    });
    expect((await counts("b")).products).toBe(5000);
  }, 400_000);

  it("un SKU que ya existe en otro producto se rechaza por fila", async () => {
    const job = await upload(
      "sku-ajeno.csv",
      csv("c", 3, (n, row) => {
        if (n === 2) row[5] = "B-5";
        return row;
      }),
    );
    const [row] = await admin<{ errors: string[] }[]>`
      select array(select jsonb_array_elements_text(errors)) as errors from public.import_job_rows
       where import_job_id = ${job.jobId} and raw ->> 'handle' = 'c-2'`;
    expect(row!.errors.join(" ")).toMatch(/sku: B-5 ya pertenece a otro producto/);
    // Sin confirmar (la dueña la abandona): no queda nada escrito.
    expect((await counts("c")).products).toBe(0);
  }, 120_000);

  it("reproceso: el mismo archivo en modo «actualizar o crear» cambia 5 000 precios y no crea productos", async () => {
    const job = await upload(
      "archivo-2-precios.csv",
      csv("b", 5000, undefined, (n) => 149 + (n % 400)),
      "upsert",
    );
    expect(job.totals).toMatchObject({ errors: 0, update: 5000, create: 0 });
    const started = Date.now();
    const preview = await asOwner(async (sql) => {
      const [row] = await sql<{ c: { price_changes: number } }[]>`
        select public.import_preview_changes(${storeId}, ${job.jobId}) as c`;
      return row!.c;
    });
    timings["vista-previa:archivo-2-precios"] = Date.now() - started;
    expect(preview.price_changes).toBe(5000);
    await commit(job.jobId);
    expect(await run("archivo-2-precios")).toMatchObject({ succeeded: 1 });
    expect((await jobStatus(job.jobId)).status).toBe("completed");
    expect((await counts("b")).products).toBe(5000);
    const [prices] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.product_variants where store_id = ${storeId} and sku = 'B-1' and price = 15000`;
    expect(prices!.n).toBe(1);
  }, 600_000);

  it("al final: ~10 000 productos en la tienda, todos buscables y ninguno en otra tienda", async () => {
    const [total] = await admin<{ products: number; stale: number; other: number }[]>`
      select (select count(*)::int from public.products where store_id = ${storeId}) as products,
             (select count(*)::int from public.products p where p.store_id = ${storeId}
                                                          and p.search_lexicon is distinct from app.product_lexicon_of(p)) as stale,
             (select count(*)::int from public.products where store_id <> ${storeId}
                                                         and (slug like 'a-%' or slug like 'b-%')) as other`;
    expect(total!.products).toBe(10_000 - badHandles);
    // CAP-03: cada archivo de 5 000 filas debe aplicarse dentro de una ejecución del
    // runner (55 s en Vercel, menos 3 s de margen). Depende del equipo: es una
    // alarma de capacidad, no una prueba unitaria.
    for (const [name, ms] of Object.entries(timings)) {
      if (name.startsWith("aplicar:") && !name.endsWith("interrumpida")) {
        expect(ms, name).toBeLessThan(52_000);
      }
    }
    expect(total!.stale).toBe(0);
    expect(total!.other).toBe(0);
  });
});
