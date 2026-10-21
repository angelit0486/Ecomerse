import { describe, expect, it } from "vitest";

import { contrastIssues } from "@/lib/theme/palette";
import { HomeSectionsV2, ThemeSettingsV2 } from "@/lib/theme/schema";

import { findTemplate, STORE_TEMPLATES, templatePayload } from "./store-templates";

describe("plantillas de tienda", () => {
  it("hay una por giro y las claves no se repiten", () => {
    expect(STORE_TEMPLATES.map((t) => t.key)).toEqual([
      "suplementos",
      "ropa",
      "belleza",
      "abarrotes",
      "generica",
    ]);
    expect(findTemplate("ropa")?.name).toBe("Ropa");
    expect(findTemplate("x")).toBeUndefined();
  });

  it.each(STORE_TEMPLATES.map((t) => [t.key, t] as const))(
    "%s: tema y portada válidos, contraste AA y límites de la base",
    (_, t) => {
      const payload = templatePayload(t);
      expect(ThemeSettingsV2.safeParse(payload.settings).success).toBe(true);
      expect(HomeSectionsV2.safeParse(payload.home_sections).success).toBe(true);
      expect(contrastIssues(t.colors, payload.settings.shape?.button_style ?? "solid")).toEqual([]);
      expect(payload.categories.length).toBeLessThanOrEqual(12);
      expect(payload.products.length).toBeLessThanOrEqual(24);
      const slugs = new Set(payload.categories.map((c) => c.slug));
      for (const p of payload.products) {
        expect(slugs.has(p.category)).toBe(true);
        // La base rechaza HTML y largos > 600; el precio va en centavos enteros.
        expect(p.description).not.toMatch(/[<>&]/);
        expect(p.description.length).toBeLessThanOrEqual(600);
        expect(p.variants.length).toBeGreaterThan(0);
        for (const v of p.variants) expect(Number.isInteger(v.price) && v.price > 0).toBe(true);
      }
    },
  );

  it("los textos no prometen efectos (cumplimiento)", () => {
    const text = JSON.stringify(STORE_TEMPLATES).toLowerCase();
    for (const term of ["cura", "garantiza", "milagro", "adelgaza", "elimina", "100%"]) {
      expect(text).not.toContain(term);
    }
  });
});
