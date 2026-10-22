/** Constantes del tema sin dependencias, para usar también en el navegador. */

export const FONT_KEYS = [
  "inter",
  "dm-sans",
  "manrope",
  "work-sans",
  "lora",
  "oswald",
  "barlow-condensed",
  "montserrat",
  "playfair-display",
  "space-grotesk",
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

export const PAYMENT_METHODS = [
  "visa",
  "mastercard",
  "amex",
  "oxxo",
  "spei",
  "paypal",
  "mercado_pago",
  "cash_on_delivery",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Tema v2 (ADR-034): de 12 a 20 bloques por página. */
export const MAX_SECTIONS = 20;
/** Con hasta 12 productos cada una, la portada nunca pasa de 48 (F9-DESIGN §13 M3). */
export const MAX_PRODUCT_SECTIONS = 4;
export const MAX_RICH_TEXT_BYTES = 20_000;

/** Íconos del bloque «Beneficios» (ADR-034): lista cerrada, se dibujan en la tienda. */
export const BENEFIT_ICONS = [
  "truck",
  "shield",
  "return",
  "chat",
  "star",
  "leaf",
  "lab",
  "card",
  "gift",
  "clock",
] as const;
export type BenefitIcon = (typeof BENEFIT_ICONS)[number];

export const SHADOWS = ["none", "soft", "strong"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const VISIBILITIES = ["all", "mobile", "desktop"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Identificadores de video: solo el id, nunca una URL ni un iframe (ADR-034). */
export const VIDEO_ID_RE = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^[0-9]{6,12}$/,
} as const;
export type VideoProvider = keyof typeof VIDEO_ID_RE;

/**
 * Fecha y hora con zona explícita (ISO 8601, años 2000–2099), igual que
 * `app.theme_instant_valid`. Además el día debe existir en ese mes
 * (`isValidInstant`).
 */
export const INSTANT_RE =
  /^(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

export function isValidInstant(value: string): boolean {
  const m = INSTANT_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Tema v4: enlaces de la barra de categorías del encabezado. */
export const MAX_NAV_ITEMS = 12;
