import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * F9-DESIGN §13 M8: el borrador nunca entra a la caché compartida de la tienda.
 * Prueba estática: el módulo de lecturas de vista previa no usa ninguna caché
 * entre requests (solo `cache` de React, que vive lo que dura el request).
 */
describe("lecturas de la vista previa", () => {
  it("no usan cachedRead ni unstable_cache", () => {
    const code = readFileSync(join(__dirname, "preview-reads.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/cachedRead|unstable_cache|from "\.\/cache"|from "next\/cache"/);
    expect(code).toMatch(/import \{ cache \} from "react"/);
  });

  /**
   * ADR-032: la marca de los borradores es LOCAL a una transacción (se descarta
   * al terminar y nunca queda en una conexión del pool) y solo la pone este módulo.
   */
  it("la marca de los borradores solo se pone aquí, local y dentro de una transacción", () => {
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
    })(join(__dirname, "..", ".."));
    const setters = files.filter(
      (f) => !f.endsWith(".test.ts") && readFileSync(f, "utf8").includes("pruva.preview_store"),
    );
    expect(setters).toEqual([join(__dirname, "preview-reads.ts")]);
    const code = readFileSync(setters[0]!, "utf8");
    expect(code.match(/set_config\('pruva\.preview_store'[^)]*\)/g)).toEqual([
      "set_config('pruva.preview_store', ${storeId}, true)",
    ]);
    expect(code).toMatch(
      /gatewayDb\(\)\.begin\(async \(tx\) => \{\s*await tx`select set_config\('pruva\.preview_store'/,
    );
  });
});
