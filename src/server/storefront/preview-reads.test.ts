import { readFileSync } from "node:fs";
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
});
