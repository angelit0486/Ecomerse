import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findGuide, HELP_GUIDES } from "./guides";

const PANEL = join(process.cwd(), "src/app/admin/[storeHandle]");

describe("ayuda del panel (paso 22)", () => {
  it("cada guía tiene identificador único, resumen y pasos", () => {
    const slugs = HELP_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of HELP_GUIDES) {
      expect(g.slug).toMatch(/^[a-z0-9-]+$/);
      expect(g.summary.length).toBeGreaterThan(10);
      expect(g.steps.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("«Ir a…» lleva a una pantalla del panel que existe", () => {
    for (const g of HELP_GUIDES) {
      const route = g.path.split("?")[0]!;
      expect(existsSync(join(PANEL, route, "page.tsx")), `${g.slug} → ${route}`).toBe(true);
    }
  });

  it("encuentra por identificador", () => {
    expect(findGuide("envios")?.title).toBe("Configurar zonas y tarifas de envío");
    expect(findGuide("no-existe")).toBeUndefined();
  });
});
