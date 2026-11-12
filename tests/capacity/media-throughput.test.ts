import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createMediaHandlers } from "@/server/media/handlers";
import { ObjectTooLargeError, type MediaBucket, type StorageAdmin } from "@/server/media/storage";
import { createLogger } from "@/server/observability/logger";

/**
 * Orden 09, RM-10: ¿cuánto tarda la cola en dejar listas las fotos de un
 * catálogo? Mide el trabajo `media.process` real (sharp: validar, recodificar,
 * quitar EXIF y hacer las copias de 320 a 1280 px) con la cola real en
 * PostgreSQL y el rol del worker. El almacenamiento es en memoria: NO incluye
 * la red hacia Supabase Storage (2 lecturas/escrituras + hasta 4 copias por foto).
 *
 * Tres fotos tipo: de catálogo web (1200 px), de cámara de celular (4000×3000)
 * y PNG con fondo. Pasadas con los límites de producción (45 s, un trabajo por
 * reclamo) y con 1, 2 y 4 pasadas a la vez.
 */
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
  key = (bucket: MediaBucket, path: string) => `${bucket}:${path}`;
  async download(bucket: MediaBucket, path: string, maxBytes: number) {
    this.ops += 1;
    const data = this.objects.get(this.key(bucket, path));
    if (!data) return null;
    if (data.length > maxBytes) throw new ObjectTooLargeError();
    return data;
  }
  async upload(bucket: MediaBucket, path: string, data: Buffer) {
    this.ops += 1;
    // Solo se cuenta: guardar 10,000 fotos en memoria no mide nada útil.
    if (bucket === "store-uploads") this.objects.set(this.key(bucket, path), data);
  }
  async remove() {
    this.ops += 1;
  }
}
const storage = new MemoryStorage();
let storeId = "";

/** Foto con textura (no un color plano: comprime como una foto real). */
async function photo(width: number, height: number, format: "jpeg" | "png") {
  const noise = Buffer.alloc(width * height * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
  const base = sharp(noise, { raw: { width, height, channels: 3 } }).blur(3);
  return format === "jpeg" ? base.jpeg({ quality: 88 }).toBuffer() : base.png().toBuffer();
}

async function enqueue(count: number, mime: string, data: Buffer) {
  const ext = mime === "image/png" ? "png" : "jpg";
  const rows = await admin<{ id: string; storage_path: string }[]>`
    with ids as (select gen_random_uuid() as id from generate_series(1, ${count}))
    insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes)
    select id, ${storeId}, 'banner', 'pending',
           ${storeId} || '/banner/' || ${storeId} || '/' || id || '/original.' || ${ext}, ${mime}, ${data.length}
      from ids
    returning id, storage_path`;
  for (const row of rows) storage.objects.set(storage.key("store-uploads", row.storage_path), data);
  await admin`
    select app.enqueue_job('media.process', jsonb_build_object('media_id', m.id), m.store_id,
                           'media.process:' || m.id)
      from public.media m where m.id = any(${rows.map((r) => r.id)}::uuid[])`;
}

/** Una pasada como la de producción (`runQueuedJobs`): 45 s y un trabajo por reclamo. */
function pass(deadlineMs: number) {
  return runJobs({
    store: jobStore,
    registry: new Map(createMediaHandlers({ db: worker, storage })),
    workerId: `cap-${crypto.randomUUID()}`,
    log,
    deadlineMs,
    hardDeadlineMs: deadlineMs + 10_000,
    batchSize: 1,
  });
}

async function measure(label: string, count: number, mime: string, data: Buffer, parallel: number) {
  await admin`delete from system.jobs`;
  await enqueue(count, mime, data);
  const started = Date.now();
  const passes = await Promise.all(Array.from({ length: parallel }, () => pass(600_000)));
  const elapsed = Date.now() - started;
  const done = passes.reduce((n, p) => n + p.succeeded, 0);
  const [state] = await admin<{ ready: number }[]>`
    select count(*)::int as ready from public.media where store_id = ${storeId} and status = 'ready'`;
  const perPhoto = elapsed / done;
  results.push({
    caso: label,
    fotos: done,
    kb_por_foto: Math.round(data.length / 1024),
    pasadas_a_la_vez: parallel,
    ms_por_foto: Math.round(perPhoto),
    fotos_por_pasada_de_45s: Math.floor((45_000 / perPhoto) * 1),
    min_para_10000: Math.round((perPhoto * 10_000) / 60_000),
  });
  expect(done).toBe(count);
  return state!.ready;
}

beforeAll(async () => {
  const [row] = await admin<{ store: string }[]>`select capgen.store(950, 0) as store`;
  storeId = row!.store;
  // Sin el tope de 50 subidas pendientes ni el de almacenamiento: aquí se mide la cola.
  await admin`update public.plan_entitlements set value_int = 100000000 where key = 'storage_mb'`;
});
afterAll(async () => {
  console.log(`RM-10 fotos: ${JSON.stringify(results)}`);
  await Promise.all([admin.end(), worker.end()]);
});

describe("RM-10: procesamiento de fotos por la cola", () => {
  it("foto de catálogo (1200×1200 JPEG): 1, 2 y 4 pasadas a la vez", async () => {
    const data = await photo(1200, 1200, "jpeg");
    await measure("catálogo 1200px", 300, "image/jpeg", data, 1);
    await measure("catálogo 1200px", 300, "image/jpeg", data, 2);
    await measure("catálogo 1200px", 400, "image/jpeg", data, 4);
  }, 900_000);

  it("foto de celular (4000×3000 JPEG): 1 y 4 pasadas a la vez", async () => {
    const data = await photo(4000, 3000, "jpeg");
    await measure("celular 4000×3000", 60, "image/jpeg", data, 1);
    await measure("celular 4000×3000", 120, "image/jpeg", data, 4);
  }, 900_000);

  it("PNG 1600×1600: 1 pasada", async () => {
    const data = await photo(1600, 1600, "png");
    await measure("PNG 1600px", 100, "image/png", data, 1);
  }, 900_000);

  it("todas quedaron listas y ninguna en otra tienda", async () => {
    const [row] = await admin<{ ready: number; other: number; pending: number }[]>`
      select count(*) filter (where store_id = ${storeId} and status = 'ready')::int as ready,
             count(*) filter (where store_id <> ${storeId})::int as other,
             count(*) filter (where store_id = ${storeId} and status = 'pending')::int as pending
        from public.media`;
    expect(row).toEqual({ ready: 1280, other: 0, pending: 0 });
    // Por foto: 1 lectura + 1 original + hasta 4 copias + 1 borrado.
    expect(storage.ops).toBeGreaterThan(1280 * 3);
  });
});
