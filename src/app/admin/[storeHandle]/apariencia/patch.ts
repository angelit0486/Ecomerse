import { COLOR_KEYS } from "@/lib/theme/palette";
import { SOCIAL_NETWORKS } from "@/lib/theme/links";
import { PAYMENT_METHODS, ThemeSettingsV1, type ThemeSettings } from "@/lib/theme/schema";

/**
 * Formulario de Apariencia → parche del tema (F9-DESIGN §7, §13 C2). Cada
 * pestaña es dueña de sus claves de primer nivel y las manda completas: una
 * clave vacía va como `null` (la base la quita). Puro: lo usa la acción y lo
 * prueban los unit.
 */
export const THEME_SECTIONS = ["marca", "encabezado", "redes", "seo"] as const;
export type ThemeSection = (typeof THEME_SECTIONS)[number];

export const SECTION_KEYS: Record<ThemeSection, readonly (keyof ThemeSettings)[]> = {
  marca: ["colors", "typography", "shape"],
  encabezado: ["header", "footer"],
  redes: ["social", "contact"],
  seo: ["seo"],
};

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
    });
  } else if (section === "encabezado") {
    const text = line(get("announcement_text"));
    const link = normalizeLink(get("announcement_link"));
    patch.header = compact({
      logo_position: get("logo_position") || undefined,
      announcement: text
        ? {
            text,
            ...(link ? { link } : {}),
            background: get("announcement_background").trim().toLowerCase(),
            foreground: get("announcement_foreground").trim().toLowerCase(),
          }
        : undefined,
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
  const parsed = ThemeSettingsV1.safeParse(present);
  if (parsed.success) return { ok: true, patch };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    let field = FIELD_FOR_PATH[path];
    if (!field && path.startsWith("colors.")) field = path.slice("colors.".length);
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
