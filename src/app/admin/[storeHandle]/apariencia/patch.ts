import { COLOR_KEYS } from "@/lib/theme/palette";
import { SOCIAL_NETWORKS } from "@/lib/theme/links";
import { PAYMENT_METHODS, ThemeSettingsV2, type ThemeSettings } from "@/lib/theme/schema";

/**
 * Formulario de Apariencia → parche del tema (F9-DESIGN §7, §13 C2). Cada
 * pestaña es dueña de sus claves de primer nivel y las manda completas: una
 * clave vacía va como `null` (la base la quita). Puro: lo usa la acción y lo
 * prueban los unit.
 */
export const THEME_SECTIONS = ["marca", "encabezado", "redes", "seo", "presentacion"] as const;
export type ThemeSection = (typeof THEME_SECTIONS)[number];

export const SECTION_KEYS: Record<ThemeSection, readonly (keyof ThemeSettings)[]> = {
  marca: ["colors", "typography", "shape", "favicon_media_id"],
  encabezado: ["header", "footer"],
  redes: ["social", "contact"],
  seo: ["seo"],
  presentacion: ["product_page", "listing"],
};

/** Casilla «sí/no» que solo se guarda cuando difiere de lo que hace la tienda por omisión. */
function flag(get: Get, name: string, fallback: boolean): boolean | undefined {
  const on = get(name) === "1";
  return on === fallback ? undefined : on;
}

type Get = (name: string) => string;

function line(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function multiline(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Normaliza un enlace escrito por una persona: agrega `https://` si falta y
 * pasa el dominio a minúsculas. Lo que no es una URL se deja igual para que el
 * esquema lo rechace con su mensaje.
 */
export function normalizeLink(value: string): string {
  const v = value.trim();
  if (!v || v.startsWith("/")) return v;
  // «categoria/proteinas» o «ofertas» son rutas de la tienda escritas sin la
  // diagonal, no un dominio: sin punto antes de la primera «/» no hay dominio.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^/?#]*\./.test(v)) return `/${v}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return v;
    const path = url.pathname === "/" && !withScheme.endsWith("/") ? "" : url.pathname;
    return `https://${url.hostname}${path}${url.search}${url.hash}`;
  } catch {
    return v;
  }
}

/** WhatsApp: sin espacios, guiones ni paréntesis; un número de 10 dígitos se toma como de México. */
export function normalizeWhatsapp(value: string): string {
  const v = value.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(v)) return `+52${v}`;
  return v;
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> | null {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : null;
}

export function sectionPatch(section: ThemeSection, get: Get, getAll: (name: string) => string[]) {
  const patch: Record<string, unknown> = {};
  if (section === "marca") {
    patch.colors = compact(
      Object.fromEntries(COLOR_KEYS.map((k) => [k, get(k).trim().toLowerCase() || undefined])),
    );
    patch.typography = compact({
      heading: get("heading_font") || undefined,
      body: get("body_font") || undefined,
    });
    patch.shape = compact({
      radius: get("radius") || undefined,
      button_style: get("button_style") || undefined,
      shadow: get("shadow") && get("shadow") !== "none" ? get("shadow") : undefined,
      density: get("density") && get("density") !== "comfortable" ? get("density") : undefined,
    });
    patch.favicon_media_id = get("favicon_media_id") || null;
  } else if (section === "encabezado") {
    const text = line(get("announcement_text"));
    const link = normalizeLink(get("announcement_link"));
    const startsAt = get("announcement_starts_at").trim();
    const endsAt = get("announcement_ends_at").trim();
    const quickLinks = [0, 1, 2, 3].flatMap((i) => {
      const label = line(get(`quick_label_${i}`));
      const href = normalizeLink(get(`quick_link_${i}`));
      return label || href ? [{ label, link: href }] : [];
    });
    patch.header = compact({
      logo_position: get("logo_position") || undefined,
      announcement: text
        ? {
            text,
            ...(link ? { link } : {}),
            background: get("announcement_background").trim().toLowerCase(),
            foreground: get("announcement_foreground").trim().toLowerCase(),
            ...(startsAt ? { starts_at: startsAt } : {}),
            ...(endsAt ? { ends_at: endsAt } : {}),
            // Apagada se guarda con su texto para volver a mostrarla con un clic.
            ...(get("announcement_toggle") && !get("announcement_shown") ? { hidden: true } : {}),
          }
        : undefined,
      quick_links: quickLinks.length ? quickLinks : undefined,
    });
    const payments = getAll("payment_methods").filter((m) =>
      (PAYMENT_METHODS as readonly string[]).includes(m),
    );
    patch.footer = compact({
      legal_text: multiline(get("legal_text")) || undefined,
      payment_methods: payments.length ? [...new Set(payments)] : undefined,
    });
  } else if (section === "redes") {
    const social = SOCIAL_NETWORKS.flatMap((network) => {
      const url = normalizeLink(get(`social_${network}`));
      return url ? [{ network, url }] : [];
    });
    patch.social = social.length ? social : null;
    patch.contact = compact({
      whatsapp: normalizeWhatsapp(get("whatsapp")) || undefined,
      address: multiline(get("address")) || undefined,
      hours: multiline(get("hours")) || undefined,
    });
  } else if (section === "presentacion") {
    patch.product_page = compact({
      gallery: get("gallery") === "dots" ? "dots" : undefined,
      show_price_per_serving: flag(get, "show_price_per_serving", true),
      show_related: flag(get, "show_related", true),
      sticky_buy_bar: flag(get, "sticky_buy_bar", true),
    });
    patch.listing = compact({
      columns_mobile: get("columns_mobile") === "1" ? 1 : undefined,
      show_brand: flag(get, "show_brand", true),
    });
  } else {
    patch.seo = compact({
      title: line(get("seo_title")) || undefined,
      description: line(get("seo_description")) || undefined,
      image_media_id: get("seo_image_media_id") || undefined,
    });
  }
  return patch;
}

/** Nombre del campo del formulario para un error de Zod (ruta dentro del tema). */
const FIELD_FOR_PATH: Record<string, string> = {
  "header.logo_position": "logo_position",
  "header.announcement.text": "announcement_text",
  "header.announcement.link": "announcement_link",
  "header.announcement.background": "announcement_background",
  "header.announcement.foreground": "announcement_foreground",
  "header.announcement.starts_at": "announcement_starts_at",
  "header.announcement.ends_at": "announcement_ends_at",
  "header.quick_links": "quick_links",
  favicon_media_id: "favicon_media_id",
  "shape.shadow": "shadow",
  "shape.density": "density",
  "footer.legal_text": "legal_text",
  "footer.payment_methods": "payment_methods",
  "typography.heading": "heading_font",
  "typography.body": "body_font",
  "shape.radius": "radius",
  "shape.button_style": "button_style",
  "contact.whatsapp": "whatsapp",
  "contact.address": "address",
  "contact.hours": "hours",
  "seo.title": "seo_title",
  "seo.description": "seo_description",
  "seo.image_media_id": "seo_image_media_id",
};

export type PatchResult =
  { ok: true; patch: Record<string, unknown> } | { ok: false; fields: Record<string, string> };

/** Valida el parche de la pestaña con el esquema v1 (los null no se validan: quitan la clave). */
export function validatePatch(patch: Record<string, unknown>): PatchResult {
  const present = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
  const parsed = ThemeSettingsV2.safeParse(present);
  if (parsed.success) return { ok: true, patch };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    let field = FIELD_FOR_PATH[path];
    if (!field && path.startsWith("colors.")) field = path.slice("colors.".length);
    if (!field && path.startsWith("header.quick_links."))
      field = `quick_label_${String(issue.path[2])}`;
    if (!field && path.startsWith("social.")) {
      const index = Number(issue.path[1]);
      const entry = (present.social as { network: string }[] | undefined)?.[index];
      field = entry ? `social_${entry.network}` : "social";
    }
    field ??= path || "form";
    fields[field] ??= issue.message;
  }
  return { ok: false, fields };
}
