import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A2 (Orden 10, mensaje 5): las comprobaciones de la ventana única preguntan si
 * hay trabajos en la cola que el código nuevo no conoce. Su lista de tipos debe
 * ser EXACTAMENTE la del registro; si alguien agrega un tipo y no actualiza los
 * guiones, esta prueba falla.
 */
const root = process.cwd();
const registry = readFileSync(join(root, "src/server/jobs/registry.ts"), "utf8");
const registered = [
  ...new Set([...registry.matchAll(/lazy\("([a-z_.]+)"/g)].map((m) => m[1]!)),
].sort();

function listed(file: string): string[] {
  const sql = readFileSync(join(root, "scripts/ops/ventana", file), "utf8");
  const block = /select unnest\(array\[([\s\S]+?)\]::text\[\]\)/.exec(sql)?.[1] ?? "";
  return [...block.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]!).sort();
}

describe("guiones de la ventana única", () => {
  it("el registro tiene el trabajo de la publicación masiva", () => {
    expect(registered).toContain("catalog.publish_run");
    expect(registered.length).toBeGreaterThan(30);
  });

  it.each(["01-antes.sql", "02-despues.sql"])(
    "%s usa la lista exacta de tipos del registro",
    (f) => {
      expect(listed(f)).toEqual(registered);
    },
  );

  it("los guiones de comprobación no escriben; el de contingencia lo dice", () => {
    for (const f of ["01-antes.sql", "02-despues.sql"]) {
      const sql = readFileSync(join(root, "scripts/ops/ventana", f), "utf8");
      expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|truncate)\b/i);
    }
    const contingency = readFileSync(
      join(root, "scripts/ops/ventana/03-retomar-publicaciones.sql"),
      "utf8",
    );
    expect(contingency).toMatch(/\*\*\* ESCRIBE \*\*\*/);
  });

  it("cada fila de 01 y 02 trae su categoría (H4-A); la cola atrasada pide autorización", () => {
    const read = (f: string) => readFileSync(join(root, "scripts/ops/ventana", f), "utf8");
    const rows = (sql: string) => sql.split(/\nunion all\n/).length;
    const before = read("01-antes.sql");
    expect(before.match(/'bloqueante'/g)).toHaveLength(rows(before));
    const after = read("02-despues.sql");
    expect(
      after.match(/'(detener|requiere_autorizacion|impide_reabrir)'(?: as categoria)?\s*(?:\n|;)/g),
    ).toHaveLength(rows(after));
    expect(after).toMatch(
      /'trabajos listos sin tomar hace más de 10 min'[\s\S]+?'requiere_autorizacion'\nunion all/,
    );
  });

  it("04-aislamiento escribe, lo dice y siempre revierte (H4-B)", () => {
    const sql = readFileSync(join(root, "scripts/ops/ventana/04-aislamiento.sql"), "utf8");
    expect(sql).toMatch(/\*\*\* ESCRIBE Y REVIERTE \*\*\*/);
    expect(sql).toMatch(/^begin;$/m);
    expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
    expect(sql).not.toMatch(/^\s*commit\b/im);
    // Sin ids escritos: las tiendas se buscan por handle.
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("la reversa de 0400 empieza con su candado, antes de cualquier cambio (H2)", () => {
    const sql = readFileSync(
      join(root, "scripts/ops/reversa/20261113000400_import_batches.reversa.sql"),
      "utf8",
    ).replace(/--.*$/gm, "");
    const guard = sql.indexOf("reversa_bloqueada");
    const firstChange = sql.search(/\b(update|delete|drop|alter|create or replace)\b/i);
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstChange);
  });
});
