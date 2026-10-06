import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";

import { DEV_ANON_KEY, DEV_SERVICE_ROLE_KEY, signDevJwt } from "../../scripts/dev/keys.mjs";

/**
 * Spike S-3 / F3-T03: subida directa a Supabase Storage REAL (servidor v1.79)
 * con la política media_upload_insert, procesamiento por el runner de la app y
 * publicación en el bucket público. Requiere el stack y la app levantados y
 * CRON_SECRET en el entorno (como tests/stack/notifications.test.ts).
 */
const API = process.env.STACK_API_URL ?? "http://127.0.0.1:54321";
const APP = process.env.STACK_PANEL_URL ?? "http://localhost:3000";
const admin = postgres(
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev",
  { max: 2, onnotice: () => {} },
);
const run = randomBytes(3).toString("hex");

async function createAuthUser(email: string): Promise<string> {
  const response = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: DEV_SERVICE_ROLE_KEY,
      authorization: `Bearer ${DEV_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`createAuthUser ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

/** Sesión de staff con 2FA: el JWT lo firma el secreto del stack (como GoTrue). */
function staffClient(userId: string, aal = "aal2"): SupabaseClient {
  const now = Math.floor(Date.now() / 1000);
  const token = signDevJwt({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    aal,
    iat: now,
    exp: now + 600,
  });
  return createClient(API, DEV_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function createTenant(key: string, ownerId: string) {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('stack_media', 'stack_media')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 3), (${plan!.id}, 'max_staff', 5), (${plan!.id}, 'max_products', 50), (${plan!.id}, 'storage_mb', 50)
              on conflict (plan_id, key) do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values (${`Org ${key}`}, ${`org-${key}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${ownerId}, 'org_owner')`;
  const [store] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${key}`}, ${`m${key}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  return store!.id;
}

async function runJobs() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Falta CRON_SECRET (el mismo que usa la app).");
  const response = await fetch(`${APP}/api/jobs/run`, {
    headers: { authorization: `Bearer ${secret}`, host: new URL(APP).host },
  });
  expect(response.status).toBe(200);
}

async function mediaRow(id: string) {
  const [row] = await admin<
    { status: string; width: number; height: number; rejection_reason: string | null }[]
  >`
    select status, width, height, rejection_reason from public.media where id = ${id}`;
  return row!;
}

let owner: SupabaseClient;
let ownerAal1: SupabaseClient;
let stranger: SupabaseClient;
let storeId = "";
let strangerStoreId = "";
let productId = "";

beforeAll(async () => {
  const health = await fetch(`${API}/storage/v1/status`).catch(() => null);
  if (!health?.ok) throw new Error("Storage apagado. Ejecuta `bash scripts/dev/stack.sh up`.");
  const ownerId = await createAuthUser(`media-${run}@example.test`);
  const strangerId = await createAuthUser(`ajeno-media-${run}@example.test`);
  owner = staffClient(ownerId);
  ownerAal1 = staffClient(ownerId, "aal1");
  stranger = staffClient(strangerId);
  storeId = await createTenant(`a${run}`, ownerId);
  strangerStoreId = await createTenant(`b${run}`, strangerId);
  const { data, error } = await owner.rpc("catalog_upsert_product", {
    p_store_id: storeId,
    p_product: { title: "Playera", variants: [{ price: 19900 }] },
  });
  if (error) throw error;
  productId = (data as { id: string }).id;
});

afterAll(async () => {
  await admin.end();
});

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: "#2a6" } })
    .withExif({ IFD0: { Make: "Teléfono", Artist: "Persona Real" } })
    .jpeg()
    .toBuffer();
}

async function put(url: string, body: Buffer, contentType: string) {
  return fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
}

describe("Supabase Storage real: subida directa con la política por store_id", () => {
  it("flujo completo: reservar → subir → finalizar → procesar → servir sin EXIF", async () => {
    const file = await photo();
    const ticket = await createMediaUpload(owner, {
      storeId,
      ownerType: "product",
      productId,
      mimeType: "image/jpeg",
      bytes: file.length,
    });
    expect(ticket.path.startsWith(`${storeId}/product/${productId}/`)).toBe(true);
    expect((await put(ticket.signedUrl, file, "image/jpeg")).status).toBe(200);

    // El original es privado: no se sirve por URL pública.
    const raw = await fetch(`${API}/storage/v1/object/public/store-uploads/${ticket.path}`);
    expect(raw.status).toBeGreaterThanOrEqual(400);

    expect((await finalizeMediaUpload(owner, storeId, ticket.mediaId)).status).toBe("pending");
    await runJobs();
    expect(await mediaRow(ticket.mediaId)).toMatchObject({
      status: "ready",
      width: 640,
      height: 480,
    });

    const published = await fetch(`${API}/storage/v1/object/public/store-media/${ticket.path}`);
    expect(published.status).toBe(200);
    expect(published.headers.get("content-type")).toBe("image/jpeg");
    const served = Buffer.from(await published.arrayBuffer());
    expect((await sharp(served).metadata()).exif).toBeUndefined();
    expect(served.includes(Buffer.from("Persona Real"))).toBe(false);

    // El worker borró el original privado.
    const service = createClient(API, DEV_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error } = await service.storage.from("store-uploads").download(ticket.path);
    expect(error).not.toBeNull();
  });

  it("polyglot HTML declarado como JPEG → rechazado y nunca publicado", async () => {
    const payload = Buffer.from("<html><script>alert(document.cookie)</script></html>");
    const ticket = await createMediaUpload(owner, {
      storeId,
      ownerType: "product",
      productId,
      mimeType: "image/jpeg",
      bytes: payload.length,
    });
    expect((await put(ticket.signedUrl, payload, "image/jpeg")).status).toBe(200);
    await finalizeMediaUpload(owner, storeId, ticket.mediaId);
    await runJobs();
    expect(await mediaRow(ticket.mediaId)).toMatchObject({
      status: "rejected",
      rejection_reason: "unsupported_format",
    });
    const published = await fetch(`${API}/storage/v1/object/public/store-media/${ticket.path}`);
    expect(published.status).toBeGreaterThanOrEqual(400);
  });

  it("Storage rechaza un Content-Type fuera de la lista (SVG) aunque la URL esté firmada", async () => {
    const ticket = await createMediaUpload(owner, {
      storeId,
      ownerType: "product",
      productId,
      mimeType: "image/png",
      bytes: 100,
    });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await put(ticket.signedUrl, svg, "image/svg+xml")).status).toBeGreaterThanOrEqual(400);
  });

  it("no se firma una ruta sin reserva, ni la reserva de otra tienda, ni sin 2FA", async () => {
    const forged = `${storeId}/product/${productId}/${crypto.randomUUID()}/original.jpg`;
    expect(
      (await owner.storage.from("store-uploads").createSignedUploadUrl(forged)).error,
    ).not.toBeNull();

    const ticket = await createMediaUpload(owner, {
      storeId,
      ownerType: "product",
      productId,
      mimeType: "image/webp",
      bytes: 100,
    });
    expect(
      (await stranger.storage.from("store-uploads").createSignedUploadUrl(ticket.path)).error,
    ).not.toBeNull();
    expect(
      (await ownerAal1.storage.from("store-uploads").createSignedUploadUrl(ticket.path)).error,
    ).not.toBeNull();
    expect(
      (await owner.storage.from("store-media").createSignedUploadUrl(ticket.path)).error,
    ).not.toBeNull();
  });

  it("otra tienda no reserva en la tuya y los buckets no se listan", async () => {
    await expect(
      createMediaUpload(stranger, {
        storeId,
        ownerType: "product",
        productId,
        mimeType: "image/jpeg",
        bytes: 100,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createMediaUpload(stranger, {
        storeId: strangerStoreId,
        ownerType: "product",
        productId,
        mimeType: "image/jpeg",
        bytes: 100,
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    const anon = createClient(API, DEV_ANON_KEY, { auth: { persistSession: false } });
    for (const client of [anon, owner]) {
      const { data } = await client.storage.from("store-media").list(storeId);
      expect(data ?? []).toEqual([]);
    }
  });
});
