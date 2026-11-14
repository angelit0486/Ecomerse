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
});
