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

export const MAX_SECTIONS = 12;
/** Con hasta 12 productos cada una, la portada nunca pasa de 48 (F9-DESIGN §13 M3). */
export const MAX_PRODUCT_SECTIONS = 4;
export const MAX_RICH_TEXT_BYTES = 20_000;
