import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Orden 06, CAP-05. El permiso por fila (RLS) cuesta ~16–29 µs por fila
 * revisada: una consulta del panel sobre una tabla de tienda SIN acotar por
 * tienda (o por una columna con índice propio) recorre las filas de TODAS las
 * tiendas y su tiempo crece con el tamaño de la plataforma, no de la tienda.
 * Toda consulta nueva debe filtrar por `store_id`; las excepciones se anotan
 * aquí con la columna indexada que las acota.
 */
const ROOT = join(__dirname, "../..");

/** Tablas de `public` con columna `store_id` (según las migraciones). */
function tenantTables(): Set<string> {
  const dir = join(ROOT, "supabase/migrations");
  const tables = new Set<string>();
  for (const file of readdirSync(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(
      /create table (?:if not exists )?public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g,
    )) {
      if (/\bstore_id\s+uuid/.test(m[2]!)) tables.add(m[1]!);
    }
  }
  return tables;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** tabla → columna con índice propio que acota la consulta (verificado con EXPLAIN). */
const ALLOWED: Record<string, string> = {
  inventory_levels: "variant_id", // inventory_levels_variant_id_location_id_key
  media: "product_id", // media_product_position_uq
  product_categories: "product_id", // product_categories_pkey
  product_options: "product_id", // product_options_name_uq
  product_variants: "product_id", // product_variants_signature_uq
  variant_costs: "variant_id", // variant_costs_pkey
};

describe("consultas del panel a tablas de tienda", () => {
  it("todas acotan por tienda (o por una columna indexada anotada)", () => {
    const tables = tenantTables();
    expect(tables.size).toBeGreaterThan(40);
    const offenders: string[] = [];
    for (const file of sources(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)) {
        const table = m[1]!;
        if (!tables.has(table)) continue;
        const end = text.indexOf(";", m.index);
        const chain = text.slice(m.index, end < 0 ? m.index + 600 : end);
        if (chain.includes("store_id")) continue;
        const allowed = ALLOWED[table];
        if (allowed && new RegExp(`\\.(eq|in)\\(\\s*"${allowed}"`).test(chain)) continue;
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${file.replace(`${ROOT}/`, "")}:${line} → ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
