import { describe, expect, it } from "vitest";

import { contrastIssues, themeContrastIssues } from "@/lib/theme/palette";
import { HomeSectionsV2, ThemeSettingsV2 } from "@/lib/theme/schema";

import {
  findTemplate,
  STORE_TEMPLATES,
  TEMPLATE_DESIGN_KEYS,
  templateAppliedMessage,
  templatePayload,
  type TemplateSettingsPatch,
} from "./store-templates";

/** El tema que queda tras aplicar la plantilla: los null solo quitan claves. */
function present(settings: TemplateSettingsPatch) {
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== null));
}

describe("plantillas de tienda", () => {
  it("hay una por giro y las claves no se repiten", () => {
    expect(STORE_TEMPLATES.map((t) => t.key)).toEqual([
      "suplementos",
      "ropa",
      "belleza",
      "abarrotes",
      "hogar",
      "mascotas",
      "joyeria",
      "electronica",
      "gourmet",
      "juguetes",
      "papeleria",
      "regalos",
      "generica",
      "blanco",
    ]);
    expect(findTemplate("ropa")?.name).toBe("Ropa");
    expect(findTemplate("x")).toBeUndefined();
  });

  it("«En blanco» no trae productos, categorías ni bloques: la tienda se diseña desde cero", () => {
    const t = findTemplate("blanco")!;
    const payload = templatePayload(t);
    expect(payload.products).toEqual([]);
    expect(payload.categories).toEqual([]);
    expect(payload.home_sections).toEqual([]);
    expect(t.name).toBe("En blanco");
  });

  it.each(STORE_TEMPLATES.map((t) => [t.key, t] as const))(
    "%s: tema y portada válidos, contraste AA y límites de la base",
    (_, t) => {
      const payload = templatePayload(t);
      const theme = ThemeSettingsV2.parse(present(payload.settings));
      expect(HomeSectionsV2.safeParse(payload.home_sections).success).toBe(true);
      expect(contrastIssues(t.colors, theme.shape?.button_style ?? "solid")).toEqual([]);
      // Igual que app.theme_contrast_issues: paleta, barra de anuncio y colores por elemento.
      expect(themeContrastIssues(theme)).toEqual([]);
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

  it("el aviso de plantilla aplicada no habla de ejemplos cuando no hay", () => {
    expect(templateAppliedMessage("En blanco", 0)).toBe(
      "Plantilla «En blanco» aplicada al borrador. Revísala en la vista previa.",
    );
    expect(templateAppliedMessage("Ropa", 1)).toBe(
      "Plantilla «Ropa» aplicada al borrador con 1 producto de ejemplo. Revísala en la vista previa.",
    );
    expect(templateAppliedMessage("Ropa", 4)).toBe(
      "Plantilla «Ropa» aplicada al borrador con 4 productos de ejemplo. Revísala en la vista previa.",
    );
  });

  it("cada giro tiene su propia personalidad (tema v5): ninguna se repite", () => {
    const withPersonality = STORE_TEMPLATES.filter((t) => !["generica", "blanco"].includes(t.key));
    for (const t of withPersonality) {
      expect(Object.keys(t.settings.personality ?? {}).length, t.key).toBeGreaterThan(0);
    }
    // La genérica y la de inicio en blanco se quedan con el aspecto de siempre.
    expect(findTemplate("generica")?.settings.personality).toBeUndefined();
    expect(findTemplate("blanco")?.settings.personality).toBeUndefined();
    const looks = withPersonality.map((t) =>
      JSON.stringify([t.settings.typography, t.settings.shape, t.settings.personality]),
    );
    expect(new Set(looks).size).toBe(withPersonality.length);
  });

  it("una plantilla reemplaza todo el diseño de la anterior, no el contenido de la tienda", () => {
    for (const t of STORE_TEMPLATES) {
      const keys = Object.keys(templatePayload(t).settings);
      for (const key of TEMPLATE_DESIGN_KEYS) expect(keys, `${t.key}: ${key}`).toContain(key);
      for (const key of ["footer", "social", "seo", "contact", "favicon_media_id"])
        expect(keys, `${t.key}: ${key}`).not.toContain(key);
    }
    // «Genérica» quita la personalidad, los colores por elemento y el encabezado de otra.
    const generic = templatePayload(findTemplate("generica")!).settings;
    expect(generic.personality).toBeNull();
    expect(generic.element_colors).toBeNull();
    expect(templatePayload(findTemplate("joyeria")!).settings.personality).toEqual(
      findTemplate("joyeria")!.settings.personality,
    );
  });
});
