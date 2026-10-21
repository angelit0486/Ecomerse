import { describe, expect, it } from "vitest";

import { parseThemeFile, portableDesign, themeFile } from "./portable";
import type { HomeSection, ThemeSettings } from "./schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const settings: ThemeSettings = {
  colors: { primary: "#0b2d5b" },
  typography: { heading: "lora" },
  favicon_media_id: uuid(90),
  seo: { title: "Mi tienda", image_media_id: uuid(91) },
  contact: { whatsapp: "+525512345678" },
  listing: { columns_mobile: 1 },
};

const sections: HomeSection[] = [
  {
    id: uuid(1),
    type: "hero",
    enabled: true,
    props: { heading: "Hola", image_media_id: uuid(92), align: "left" },
  },
  {
    id: uuid(2),
    type: "featured_products",
    enabled: true,
    props: {
      title: "Proteínas",
      source: { type: "category", id: uuid(93) },
      limit: 8,
      show_view_all: true,
    },
  },
  {
    id: uuid(3),
    type: "category_grid",
    enabled: true,
    props: { title: "Categorías", category_ids: [uuid(94)] },
  },
  {
    id: uuid(4),
    type: "promo_banner",
    enabled: true,
    props: { image_media_id: uuid(95) },
  },
  { id: uuid(5), type: "reviews", enabled: true, props: { title: "Opiniones", limit: 6 } },
];

describe("diseño portátil", () => {
  it("se queda solo con el diseño, sin imágenes ni filas de la tienda", () => {
    const design = portableDesign(settings, sections);
    expect(design.settings).toEqual({
      colors: { primary: "#0b2d5b" },
      typography: { heading: "lora" },
      listing: { columns_mobile: 1 },
    });
    expect(design.home_sections.map((s) => s.type)).toEqual([
      "hero",
      "featured_products",
      "category_grid",
      "reviews",
    ]);
    const text = JSON.stringify(design);
    for (const n of [90, 91, 92, 93, 94, 95]) expect(text).not.toContain(uuid(n));
    expect(design.home_sections[1]).toMatchObject({ props: { source: { type: "newest" } } });
  });

  it("exportar y volver a importar da lo mismo", () => {
    const design = portableDesign(settings, sections);
    expect(parseThemeFile(themeFile(design, "Mi tienda"))).toEqual({ ok: true, design });
  });

  it("un archivo con ids de otra tienda se limpia al importar", () => {
    const file = JSON.stringify({
      format: "pruva-theme",
      version: 2,
      settings,
      home_sections: sections,
    });
    const parsed = parseThemeFile(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(parsed.design)).not.toContain(uuid(92));
  });

  it.each([
    ["no es JSON", "{"],
    ["otro formato", JSON.stringify({ format: "otro" })],
    ["versión desconocida", JSON.stringify({ format: "pruva-theme", version: 9 })],
    [
      "datos inválidos",
      JSON.stringify({
        format: "pruva-theme",
        version: 2,
        settings: { colors: { primary: "rojo" } },
      }),
    ],
  ])("rechaza %s", (_, text) => {
    expect(parseThemeFile(text).ok).toBe(false);
  });
});
