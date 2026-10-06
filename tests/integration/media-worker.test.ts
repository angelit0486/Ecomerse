import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { createMediaHandlers } from "@/server/media/handlers";
import { ObjectTooLargeError, type MediaBucket, type StorageAdmin } from "@/server/media/storage";
import { createLogger } from "@/server/observability/logger";

/**
 * Worker de medios (F3-T03) contra PostgreSQL real con el rol system_worker y un
 * Storage en memoria. Ejecutar con `pnpm db:test`. El flujo contra el servidor
 * real de Storage está en tests/stack/media.test.ts.
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
  async download(bucket: MediaBucket, path: string, maxBytes: number) {
    const object = this.objects.get(this.key(bucket, path));
    if (!object) return null;
    if (object.data.length > maxBytes) throw new ObjectTooLargeError();
    return object.data;
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
const log = createLogger({ sink: (line) => logLines.push(line) });
let storeId = "";
let otherStoreId = "";

async function run() {
  return runJobs({
    store,
    registry: new Map(createMediaHandlers({ db: worker, storage })),
    workerId: "test",
    log,
  });
}

/** Simula media_create_upload + subida + media_finalize (las RPC tienen su pgTAP). */
async function pendingMedia(
  mime: string,
  data: Buffer,
  opts: { store?: string; ownerType?: string } = {},
) {
  const sid = opts.store ?? storeId;
  const ext = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  }[mime];
  const [row] = await admin<{ id: string; storage_path: string }[]>`
    with id as (select gen_random_uuid() as id)
    insert into public.media (id, store_id, owner_type, status, storage_path, mime_type, bytes)
    select id.id, ${sid}, ${opts.ownerType ?? "banner"}, 'pending',
           ${sid} || '/banner/' || ${sid} || '/' || id.id || '/original.' || ${ext ?? "jpg"},
           ${mime}, ${Math.max(1, Math.min(data.length, 10485760))}
      from id
    returning id, storage_path`;
  storage.objects.set(storage.key("store-uploads", row!.storage_path), { data });
  await admin`select app.enqueue_job('media.process', ${admin.json({ media_id: row!.id })}, ${sid},
                                     ${`media.process:${row!.id}`})`;
  return row!;
}

async function media(id: string) {
  const [row] = await admin<
    {
      status: string;
      width: number | null;
      height: number | null;
      bytes: string;
      rejection_reason: string | null;
    }[]
  >`select status, width, height, bytes, rejection_reason from public.media where id = ${id}`;
  return row!;
}

async function tenant(key: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('media_plan', 'media_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'storage_mb', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values (${`Org ${key}`}, ${`org-media-${key}`}, 'MX')
    returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${key}`}, ${`media-${key}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  return s!.id;
}

beforeAll(async () => {
  storeId = await tenant("a");
  otherStoreId = await tenant("b");
});

beforeEach(async () => {
  await admin`delete from system.jobs`;
  storage = new MemoryStorage();
  logLines = [];
});

afterAll(async () => {
  await admin.end();
  await worker.end();
});

describe("media.process", () => {
  it("publica la imagen re-codificada, guarda dimensiones y borra el original", async () => {
    const jpeg = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#c33" },
    })
      .withExif({ IFD0: { Make: "Teléfono", Copyright: "secreto" } })
      .jpeg()
      .toBuffer();
    const row = await pendingMedia("image/jpeg", jpeg);

    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(await media(row.id)).toMatchObject({ status: "ready", width: 300, height: 200 });
    expect(storage.objects.has(storage.key("store-uploads", row.storage_path))).toBe(false);
    const published = storage.objects.get(storage.key("store-media", row.storage_path))!;
    expect(published.contentType).toBe("image/jpeg");
    expect((await sharp(published.data).metadata()).exif).toBeUndefined();
    expect(Number((await media(row.id)).bytes)).toBe(published.data.length);
  });

  it("rechaza un MIME falso y no publica nada", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    const row = await pendingMedia("image/jpeg", png);

    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "mime_mismatch",
    });
    expect(storage.objects.size).toBe(0);
  });

  it("rechaza SVG con script aunque se declare PNG", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const row = await pendingMedia("image/png", svg);
    await run();
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "unsupported_format",
    });
    expect(storage.objects.size).toBe(0);
  });

  it("archivo ausente → rechazado con missing_file", async () => {
    const row = await pendingMedia("image/png", Buffer.from("x"));
    storage.objects.clear();
    await run();
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "missing_file",
    });
  });

  it("branding de más de 2 MB → too_large sin descargarlo entero", async () => {
    const row = await pendingMedia("image/png", Buffer.alloc(2 * 1024 * 1024 + 1, 1), {
      ownerType: "store_branding",
    });
    await run();
    expect(await media(row.id)).toMatchObject({
      status: "rejected",
      rejection_reason: "too_large",
    });
  });

  it("es idempotente: un medio ya procesado no se vuelve a procesar", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const row = await pendingMedia("image/png", png);
    await run();
    storage.objects.clear();
    await admin`select app.enqueue_job('media.process', ${admin.json({ media_id: row.id })}, ${storeId}, 'again')`;
    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(storage.objects.size).toBe(0);
    expect((await media(row.id)).status).toBe("ready");
  });

  it("job con una tienda distinta a la del medio → dead, sin tocar nada", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const row = await pendingMedia("image/png", png);
    await admin`delete from system.jobs`;
    await admin`select app.enqueue_job('media.process', ${admin.json({ media_id: row.id })}, ${otherStoreId}, 'cross')`;
    expect(await run()).toMatchObject({ dead: 1 });
    expect((await media(row.id)).status).toBe("pending");
    expect(storage.objects.has(storage.key("store-media", row.storage_path))).toBe(false);
  });

  it("payload inválido → dead (no se reintenta)", async () => {
    await admin`select app.enqueue_job('media.process', ${admin.json({ media_id: "../../etc/passwd" })}, ${storeId})`;
    expect(await run()).toMatchObject({ dead: 1 });
  });
});

describe("media.purge_orphans", () => {
  it("borra objetos y filas vencidas; conserva lo vigente", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const live = await pendingMedia("image/png", png);
    await run();
    const expired = await pendingMedia("image/png", png);
    await admin`delete from system.jobs`;
    await admin`update public.media set created_at = now() - interval '25 hours' where id = ${expired.id}`;

    await admin`select system.enqueue_maintenance()`;
    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(storage.objects.has(storage.key("store-uploads", expired.storage_path))).toBe(false);
    expect(await admin`select 1 from public.media where id = ${expired.id}`).toHaveLength(0);
    expect(storage.objects.has(storage.key("store-media", live.storage_path))).toBe(true);
    expect((await media(live.id)).status).toBe("ready");
    expect(logLines.join("\n")).toContain("Purga de medios");
  });
});
