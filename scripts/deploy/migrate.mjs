#!/usr/bin/env node
// =============================================================================
// Migraciones en el build de Vercel (vista previa, D-F9-17).
//
// Aplica en orden los archivos de supabase/migrations que falten, cada uno en
// su propia transacción, y los registra en supabase_migrations.schema_migrations
// (la misma tabla que usa la CLI de Supabase). Forward-only: nunca revierte ni
// reescribe una migración ya aplicada; si su contenido cambió, se detiene.
//
// Sin MIGRATION_DATABASE_URL no hace nada (builds locales y de CI).
// =============================================================================
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

const URL = process.env.MIGRATION_DATABASE_URL;
if (!URL) {
  console.log("· Sin MIGRATION_DATABASE_URL: no se aplican migraciones.");
  process.exit(0);
}

const DIR = "supabase/migrations";
const sql = postgres(URL, { max: 1, onnotice: () => {}, prepare: false, connect_timeout: 30 });

async function main() {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (
              version text primary key, statements text[], name text)`;
  await sql`alter table supabase_migrations.schema_migrations
              add column if not exists checksum text`;
  const applied = new Map(
    (await sql`select version, checksum from supabase_migrations.schema_migrations`).map((r) => [
      r.version,
      r.checksum,
    ]),
  );
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let count = 0;
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    const body = readFileSync(join(DIR, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    if (applied.has(version)) {
      const previous = applied.get(version);
      if (previous && previous !== checksum) {
        throw new Error(`${file} cambió después de aplicarse (forward-only: crea otra migración).`);
      }
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations (version, name, checksum)
               values (${version}, ${rest.join("_")}, ${checksum})`;
    });
    count += 1;
    console.log(`✓ ${file}`);
  }
  console.log(`✓ Migraciones al día (${count} nuevas de ${files.length}).`);
}

try {
  await main();
} catch (error) {
  // Solo el mensaje de Postgres: nunca la cadena de conexión.
  console.error("✗ Migración fallida:", error.message ?? error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
