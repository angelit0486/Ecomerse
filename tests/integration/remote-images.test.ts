import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createMediaHandlers } from "@/server/media/handlers";
import type { RemoteFetchResult } from "@/server/media/remote-fetch";
import type { MediaBucket, StorageAdmin } from "@/server/media/storage";
import { createLogger } from "@/server/observability/logger";

/**
 * ADR-033 · media.fetch_remote contra PostgreSQL real (rol system_worker) con un
 * Storage en memoria y la descarga simulada. Los controles de SSRF de la descarga
 * real se prueban en src/server/media/remote-fetch.test.ts.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const store = createPostgresJobStore(worker);

class MemoryStorage implements StorageAdmin {
  objects = new Map<string, { data: Buffer; contentType?: string }>();
  key = (bucket: MediaBucket, path: string) => `${bucket}:${path}`;
  async download(bucket: MediaBucket, path: string) {
    return this.objects.get(this.key(bucket, path))?.data ?? null;
  }
  async upload(bucket: MediaBucket, path: string, data: Buffer, contentType: string) {
    this.objects.set(this.key(bucket, path), { data, contentType });
  }
  async remove(bucket: MediaBucket, paths: string[]) {
    for (const path of paths) this.objects.delete(this.key(bucket, path));
  }
}

let storage = new MemoryStorage();
let logLines: string[] = [];
let storeId = "";
let fetched: string[] = [];
let respond: (url: string) => RemoteFetchResult = () => ({
  ok: false,
  reason: "fetch_failed",
  retryable: true,
});

async function run() {
  return runJobs({
    store,
    registry: new Map(
      createMediaHandlers({
        db: worker,
        storage,
        fetchImage: async (url) => {
          fetched.push(url);
          return respond(url);
        },
      }),
    ),
    workerId: "test",
    log: createLogger({ sink: (line) => logLines.push(line) }),
  });
}

/** Lo que deja system.import_queue_remote_images (su pgTAP cubre la reserva). */
async function remoteMedia(url: string) {
  const [row] = await admin<{ id: string; storage_path: string }[]>`
    with id as (select gen_random_uuid() as id)
    insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, source_url)
    select id.id, ${storeId}, 'banner', 'pending',
           ${storeId} || '/banner/' || ${storeId} || '/' || id.id || '/original.jpg', 'image/jpeg', ${url}
      from id
    returning id, storage_path`;
  await admin`select app.enqueue_job('media.fetch_remote', ${admin.json({ media_id: row!.id })}, ${storeId},
                                     ${`media.fetch_remote:${row!.id}`})`;
  return row!;
}

async function media(id: string) {
  const [row] = await admin<
    { status: string; mime_type: string; width: number | null; rejection_reason: string | null }[]
  >`select status, mime_type, width, rejection_reason from public.media where id = ${id}`;
  return row!;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('remote_plan', 'remote_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'storage_mb', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org remota', 'org-remote-images', 'MX')
    returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda remota', 'remote-images', 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
});

beforeEach(async () => {
  await admin`delete from system.jobs`;
  storage = new MemoryStorage();
  logLines = [];
  fetched = [];
});

afterAll(async () => {
  await admin.end();
  await worker.end();
});

describe("media.fetch_remote", () => {
  it("descarga, toma el tipo real y publica la foto re-codificada", async () => {
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#0b2d5b" },
    })
      .png()
      .toBuffer();
    respond = () => ({ ok: true, data: png, contentType: "image/jpeg" }); // cabecera engañosa
    const url = "https://cdn.example.com/files/whey.png?token=secreto";
    const row = await remoteMedia(url);

    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(fetched).toEqual([url]);
    expect(await media(row.id)).toMatchObject({
      status: "ready",
      mime_type: "image/png",
      width: 64,
    });
    expect(storage.objects.get(storage.key("store-media", row.storage_path))?.contentType).toBe(
      "image/png",
    );
    expect(storage.objects.has(storage.key("store-uploads", row.storage_path))).toBe(false);
    // El enlace (que puede llevar una firma) nunca llega a los logs.
    expect(logLines.join("\n")).not.toContain("secreto");
  });

  it("una dirección bloqueada se rechaza sin reintentar ni subir nada", async () => {
    respond = () => ({ ok: false, reason: "fetch_blocked", retryable: false, detail: "address" });
    const row = await remoteMedia("https://internal.example.com/a.jpg");
    await run();
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "fetch_blocked",
    });
    expect(storage.objects.size).toBe(0);
  });

  it("lo descargado que no es imagen (HTML, SVG) se rechaza", async () => {
    respond = () => ({
      ok: true,
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      contentType: "image/svg+xml",
    });
    const row = await remoteMedia("https://cdn.example.com/a.svg");
    await run();
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "unsupported_format",
    });
    expect(storage.objects.size).toBe(0);
  });

  it("un fallo de red se reintenta más tarde (la foto sigue pendiente)", async () => {
    respond = () => ({ ok: false, reason: "fetch_failed", retryable: true, detail: "timeout" });
    const row = await remoteMedia("https://cdn.example.com/slow.jpg");
    expect(await run()).toMatchObject({ retried: 1 });
    expect(await media(row.id)).toMatchObject({ status: "pending" });
    const [job] = await admin<{ status: string; attempts: number }[]>`
      select status, attempts from system.jobs where type = 'media.fetch_remote'`;
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
  });

  it("una foto ya rechazada o borrada no se vuelve a descargar", async () => {
    const row = await remoteMedia("https://cdn.example.com/b.jpg");
    await admin`update public.media set deleted_at = now() where id = ${row.id}`;
    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(fetched).toEqual([]);
  });
});
