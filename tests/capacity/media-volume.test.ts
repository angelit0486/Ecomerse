import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createMediaHandlers } from "@/server/media/handlers";
import { ObjectTooLargeError, type MediaBucket, type StorageAdmin } from "@/server/media/storage";
import { createLogger } from "@/server/observability/logger";

/**
 * RM-10 (2026-11-28): 1,000 y 10,000 fotos de verdad, no extrapoladas. Cada caso
 * encola N fotos y las procesa con el `media.process` real, la cola real en
 * PostgreSQL y el rol del worker, en pasadas SUCESIVAS con los límites de
 * producción (`runQueuedJobs`: 45 s y un trabajo por reclamo) hasta vaciar la cola.
 * Con «4 a la vez» cada ronda lanza 4 pasadas juntas.
 *
 * El almacenamiento es en memoria; el caso con latencia agrega una espera fija por
 * operación para estimar la red hacia Storage (SIMULADO). Solo local:
 * `bash scripts/capacity/media-volume.sh`. Criterios: docs/audit/RM-10-medicion-fotos.md.
 */
const PASS_MS = 45_000;
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 3, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 8,
  prepare: false,
  onnotice: () => {},
});
const jobStore = createPostgresJobStore(worker);
const log = createLogger({ sink: () => {} });
const results: Record<string, unknown>[] = [];

class MemoryStorage implements StorageAdmin {
  objects = new Map<string, Buffer>();
  ops = 0;
  delayMs = 0;
  key = (bucket: MediaBucket, path: string) => `${bucket}:${path}`;
  private async wait() {
    this.ops += 1;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }
  async download(bucket: MediaBucket, path: string, maxBytes: number) {
    await this.wait();
    const data = this.objects.get(this.key(bucket, path));
    if (!data) return null;
    if (data.length > maxBytes) throw new ObjectTooLargeError();
    return data;
  }
  async upload(_bucket: MediaBucket, _path: string, _data: Buffer) {
    // Solo se cuenta: guardar 10,000 copias en memoria no mide nada útil.
    await this.wait();
  }
  async remove(_bucket: MediaBucket, paths: string[]) {
    await this.wait();
    for (const p of paths) this.objects.delete(this.key("store-uploads", p));
  }
}
const storage = new MemoryStorage();
let storeId = "";
let otherStoreId = "";
let photoData: Buffer;

/** Foto con textura (no un color plano: comprime como una foto real). */
async function photo(width: number, height: number) {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  return sharp(noise, { raw: { width, height, channels: 3 } })
    .blur(3)
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function enqueue(store: string, count: number, withJob = true) {
  const rows = await admin<{ id: string; storage_path: string }[]>`
    with ids as (select gen_random_uuid() as id from generate_series(1, ${count}))
    insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes)
    select id, ${store}, 'banner', 'pending',
           ${store} || '/banner/' || ${store} || '/' || id || '/original.jpg', 'image/jpeg', ${photoData.length}
      from ids
    returning id, storage_path`;
  // La misma referencia de Buffer para todas: 10,000 fotos no ocupan 10,000 copias.
  for (const row of rows)
    storage.objects.set(storage.key("store-uploads", row.storage_path), photoData);
  if (withJob) {
    await admin`
      select app.enqueue_job('media.process', jsonb_build_object('media_id', m.id), m.store_id,
                             'media.process:' || m.id)
        from public.media m where m.id = any(${rows.map((r) => r.id)}::uuid[])`;
  }
  return rows.map((r) => r.id);
}

/** Una pasada como la de producción (`runQueuedJobs`). */
function pass() {
  return runJobs({
    store: jobStore,
    registry: new Map(createMediaHandlers({ db: worker, storage })),
    workerId: `cap-${crypto.randomUUID()}`,
    log,
    deadlineMs: PASS_MS,
    hardDeadlineMs: PASS_MS + 10_000,
    batchSize: 1,
  });
}

async function measure(label: string, count: number, parallel: number, delayMs = 0) {
  await admin`delete from system.jobs`;
  await admin`delete from public.media where store_id = ${storeId}`;
  storage.delayMs = delayMs;
  const opsBefore = storage.ops;
  const ids = await enqueue(storeId, count);
  let rss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    rss = Math.max(rss, process.memoryUsage().rss);
  }, 500);
  const perRound: number[] = [];
  let succeeded = 0;
  let dead = 0;
  let retried = 0;
  const started = Date.now();
  try {
    // Rondas de pasadas hasta vaciar la cola (con un tope de seguridad).
    for (let round = 0; succeeded + dead < count && round < 500; round += 1) {
      const passes = await Promise.all(Array.from({ length: parallel }, () => pass()));
      const done = passes.reduce((n, p) => n + p.succeeded, 0);
      dead += passes.reduce((n, p) => n + p.dead, 0);
      retried += passes.reduce((n, p) => n + p.retried, 0);
      if (done === 0 && passes.every((p) => p.claimed === 0)) break;
      succeeded += done;
      perRound.push(done);
    }
  } finally {
    clearInterval(sampler);
  }
  const elapsed = Date.now() - started;
  const full = perRound.slice(0, -1);
  const perPass = full.length
    ? Math.round(full.reduce((a, b) => a + b, 0) / full.length / parallel)
    : succeeded;
  const row = {
    caso: label,
    fotos: count,
    pasadas_a_la_vez: parallel,
    latencia_storage_ms: delayMs,
    rondas_de_45s: perRound.length,
    fotos_por_pasada_45s_medidas: perPass,
    ms_por_foto: Math.round(elapsed / Math.max(succeeded, 1)),
    total_s: Math.round(elapsed / 1000),
    rss_pico_mb: Math.round(rss / 1024 / 1024),
    ops_storage_por_foto: Number(((storage.ops - opsBefore) / Math.max(succeeded, 1)).toFixed(1)),
  };
  results.push(row);
  console.log(`RM-10 caso: ${JSON.stringify(row)}`);

  // A5: integridad.
  expect(dead).toBe(0);
  expect(retried).toBe(0);
  expect(succeeded).toBe(count);
  const [state] = await admin<
    {
      ready: number;
      other_status: number;
      jobs_ok: number;
      jobs_other: number;
      attempts_gt1: number;
    }[]
  >`
    select (select count(*) from public.media where id = any(${ids}::uuid[]) and status = 'ready')::int as ready,
           (select count(*) from public.media where id = any(${ids}::uuid[]) and status <> 'ready')::int as other_status,
           (select count(*) from system.jobs where type = 'media.process' and status = 'succeeded')::int as jobs_ok,
           (select count(*) from system.jobs where status <> 'succeeded')::int as jobs_other,
           (select count(*) from system.jobs where attempts > 1)::int as attempts_gt1`;
  expect(state).toEqual({
    ready: count,
    other_status: 0,
    jobs_ok: count,
    jobs_other: 0,
    attempts_gt1: 0,
  });
  return row;
}

beforeAll(async () => {
  photoData = await photo(1200, 1200);
  const [a] = await admin<{ store: string }[]>`select capgen.store(960, 0) as store`;
  const [b] = await admin<{ store: string }[]>`select capgen.store(961, 0) as store`;
  storeId = a!.store;
  otherStoreId = b!.store;
  // Sin el tope de subidas pendientes ni de almacenamiento: aquí se mide la cola.
  await admin`update public.plan_entitlements set value_int = 100000000 where key = 'storage_mb'`;
  // Otra tienda con fotos pendientes SIN trabajo: la cola no debe tocarlas.
  await enqueue(otherStoreId, 25, false);
}, 120_000);

afterAll(async () => {
  console.log(`RM-10 volumen: ${JSON.stringify(results)}`);
  await Promise.all([admin.end(), worker.end()]);
});

describe("RM-10: 1,000 y 10,000 fotos por la cola real, en pasadas de 45 s", () => {
  it("1,000 fotos de catálogo con 1 pasada a la vez", async () => {
    await measure("1,000 catálogo", 1_000, 1);
  }, 1_800_000);

  it("1,000 fotos de catálogo con 4 pasadas a la vez", async () => {
    await measure("1,000 catálogo", 1_000, 4);
  }, 1_800_000);

  it("1,000 fotos con 50 ms por operación de Storage (SIMULADO), 1 pasada", async () => {
    await measure("1,000 catálogo + red simulada", 1_000, 1, 50);
  }, 1_800_000);

  it("10,000 fotos de catálogo con 4 pasadas a la vez", async () => {
    await measure("10,000 catálogo", 10_000, 4);
  }, 3_600_000);

  it("10,000 fotos de catálogo con 1 pasada a la vez (una llamada del cron cada vez)", async () => {
    await measure("10,000 catálogo", 10_000, 1);
  }, 5_400_000);

  it("la otra tienda no se tocó", async () => {
    const [row] = await admin<{ pending: number; total: number }[]>`
      select count(*) filter (where status = 'pending')::int as pending, count(*)::int as total
        from public.media where store_id = ${otherStoreId}`;
    expect(row).toEqual({ pending: 25, total: 25 });
  });
});
