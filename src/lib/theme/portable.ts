import { HomeSectionsV2, ThemeSettingsV2, type HomeSection, type ThemeSettings } from "./schema";

/**
 * Diseño portátil (ADR-034 §6): lo que se puede llevar de una tienda a otra.
 * Sin imágenes ni filas de la tienda de origen (categorías, marcas, productos,
 * objetivos): en otra tienda no existen. Tampoco SEO, contacto, redes, favicon
 * ni pie, que son de cada tienda.
 */
export const DESIGN_KEYS = [
  "colors",
  "typography",
  "shape",
  "header",
  "product_page",
  "listing",
] as const;

export const THEME_FILE_FORMAT = "pruva-theme";
export const MAX_THEME_FILE_BYTES = 256 * 1024;

export interface PortableDesign {
  settings: ThemeSettings;
  home_sections: HomeSection[];
}

/** Bloques que no tienen sentido sin las filas o imágenes de su tienda. */
const STORE_BOUND = new Set(["promo_banner", "image_with_text", "brand_logos", "goals"]);

function portableSection(s: HomeSection): HomeSection | null {
  if (STORE_BOUND.has(s.type)) return null;
  if (s.type === "hero") {
    const { image_media_id: _image, ...props } = s.props;
    return { ...s, props };
  }
  if (s.type === "category_grid") {
    const { category_ids: _ids, ...props } = s.props;
    return { ...s, props };
  }
  if (s.type === "featured_products" && !["newest", "best_selling"].includes(s.props.source.type)) {
    return { ...s, props: { ...s.props, source: { type: "newest" } } };
  }
  return s;
}

export function portableDesign(settings: ThemeSettings, sections: HomeSection[]): PortableDesign {
  const out: ThemeSettings = {};
  for (const key of DESIGN_KEYS) {
    if (settings[key] !== undefined) Object.assign(out, { [key]: settings[key] });
  }
  return {
    settings: out,
    home_sections: sections.map(portableSection).filter((s): s is HomeSection => s !== null),
  };
}

/** Archivo descargable. */
export function themeFile(design: PortableDesign, storeName: string): string {
  return JSON.stringify(
    { format: THEME_FILE_FORMAT, version: 2, store: storeName, ...design },
    null,
    2,
  );
}

export type ParseResult = { ok: true; design: PortableDesign } | { ok: false; error: string };

/** Lee un archivo exportado; lo que traiga de más se descarta al hacerlo portátil. */
export function parseThemeFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "El archivo no es un diseño exportado desde el panel." };
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { format?: unknown }).format !== THEME_FILE_FORMAT
  ) {
    return { ok: false, error: "El archivo no es un diseño exportado desde el panel." };
  }
  const file = raw as { version?: unknown; settings?: unknown; home_sections?: unknown };
  if (file.version !== 1 && file.version !== 2) {
    return { ok: false, error: "Ese archivo es de una versión del diseño que no reconocemos." };
  }
  const settings = ThemeSettingsV2.safeParse(file.settings ?? {});
  const sections = HomeSectionsV2.safeParse(file.home_sections ?? []);
  if (!settings.success || !sections.success) {
    return { ok: false, error: "El archivo tiene datos que no son válidos. Expórtalo de nuevo." };
  }
  return { ok: true, design: portableDesign(settings.data, sections.data) };
}
