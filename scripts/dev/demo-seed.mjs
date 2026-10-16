#!/usr/bin/env node
// =============================================================================
// Datos de demostración de la tienda insignia (F9-T05, F9-DESIGN §15 y §16).
// SOLO para el stack local: capturas, Lighthouse y revisión del propietario.
// La lógica y el catálogo viven en supabase/functions/demo-seed/seed-core.mjs,
// que también usa la Edge Function de la vista previa (D-F9-17).
//
// Uso:  pnpm demo:seed            tienda demo.localhost (estilo «Deportivo»)
//       pnpm demo:seed:neutral    tienda demo2.localhost (estilo «Neutral»)
//       node scripts/dev/demo-seed.mjs --export-media supabase/functions/demo-seed/media
//         (re-genera las ilustraciones WebP que sube la Edge Function; sin base de datos)
// =============================================================================
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";
import sharp from "sharp";

import { demoSvgs, seedDemo } from "../../supabase/functions/demo-seed/seed-core.mjs";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function renderWebp(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer({
    resolveWithObject: true,
  });
  return { data, width: info.width, height: info.height };
}

// --export-media <dir>: <sha256 del SVG>.webp + manifest.json (bytes, medidas y
// sha256 del WebP, que la Edge Function verifica antes de subir).
const exportAt = process.argv.indexOf("--export-media");
if (exportAt !== -1) {
  const dir = process.argv[exportAt + 1];
  if (!dir) {
    console.error("✗ Indica la carpeta: --export-media <carpeta>");
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  const manifest = {};
  for (const svg of demoSvgs()) {
    const key = sha256(svg);
    const { data, width, height } = await renderWebp(svg);
    writeFileSync(join(dir, `${key}.webp`), data);
    manifest[key] = { sha256: sha256(data), bytes: data.length, width, height };
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ ${Object.keys(manifest).length} ilustraciones en ${dir}`);
  process.exit(0);
}

const DB_URL =
  process.env.STACK_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pruva_dev";
const API = process.env.STACK_API_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// `--neutral`: segunda tienda (demo2.localhost) con el estilo «Neutral», para
// medir que el rendimiento y la accesibilidad no dependen de un tema (§16).
const NEUTRAL = process.argv.includes("--neutral");

function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    console.error(`✗ Solo local: ${host} no es localhost. No se toca ninguna otra base.`);
    process.exit(1);
  }
}
assertLocal(DB_URL);
assertLocal(API);
if (!SERVICE_KEY) {
  console.error("✗ Falta SUPABASE_SERVICE_ROLE_KEY: carga .env.local (pnpm stack env).");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const adminHeaders = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };

async function createOwner(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Auth ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function putImage({ path, svg }) {
  const { data, width, height } = await renderWebp(svg);
  const res = await fetch(`${API}/storage/v1/object/store-media/${path}`, {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "image/webp", "x-upsert": "true" },
    body: data,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${await res.text()}`);
  return { bytes: data.length, width, height };
}

const handle = NEUTRAL ? "demo2" : "demo";
seedDemo({
  sql,
  neutral: NEUTRAL,
  hostname: `${handle}.localhost`,
  createOwner,
  putImage,
  // Stack local: activa el perfil con un revisor de demostración (nunca fuera de localhost).
  demoCompliance: true,
  log: console.log,
})
  .then(({ created }) => {
    if (created)
      console.log(`  Panel: http://localhost:3000/admin/${handle} (dueña ${handle}@example.test)`);
    else console.log("  Para rehacerla desde cero: pnpm stack reset && pnpm demo:seed");
  })
  .catch((error) => {
    console.error("✗", error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
