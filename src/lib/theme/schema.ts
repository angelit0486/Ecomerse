import { z } from "zod";

import { COLOR_KEYS } from "./palette";
import { isValidLink, isValidSocialUrl, SOCIAL_NETWORKS } from "./links";

// Este esquema también corre en el navegador (Apariencia). Sin `jitless`, Zod
// prueba `new Function("")` para compilar validadores y la CSP (sin unsafe-eval)
// lo bloquea: funcionaba, pero dejaba una violación de CSP en cada carga.
z.config({ jitless: true });

/**
 * Theme schema v1 (GATE0 §20.2 y §43; F9-DESIGN §2 y §3). Validación
 * estructural sin estado: la base repite cada regla (`app.theme_settings_valid`,
 * `app.home_sections_valid`) y `tests/integration/theme-schema-parity.test.ts`
 * compara ambas con `theme-schema-cases.ts`. Las referencias a filas de la
 * tienda (imágenes, categorías, marcas, valores de atributo) las valida la base,
 * que conoce la tienda.
 *
 * Los textos llegan ya recortados y sin caracteres de control (la base rechaza
 * lo que no lo esté); los largos se cuentan en puntos de código, como
 * `char_length` (§13 M2).
 */

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

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINE_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/** Largo en puntos de código (igual que `char_length` en Postgres). */
export function codePoints(value: string): number {
  return [...value].length;
}

function text(min: number, max: number, multiline = false) {
  const control = multiline ? CONTROL_EXCEPT_NEWLINE_RE : CONTROL_RE;
  return z.string({ error: "Escribe este campo." }).superRefine((value, ctx) => {
    if (value !== value.trim()) {
      ctx.addIssue({ code: "custom", message: "Quita los espacios al inicio y al final." });
    } else if (control.test(value)) {
      ctx.addIssue({ code: "custom", message: "Tiene caracteres no permitidos." });
    } else if (codePoints(value) < min) {
      ctx.addIssue({ code: "custom", message: "Escribe este campo." });
    } else if (codePoints(value) > max) {
      ctx.addIssue({ code: "custom", message: `Máximo ${max} caracteres.` });
    }
  });
}

const hex = z
  .string({ error: "Elige un color." })
  .regex(/^#[0-9a-f]{6}$/, "Usa un color como #1d4ed8.");
const link = z
  .string({ error: "Escribe el enlace." })
  .refine(isValidLink, "Usa una ruta de tu tienda (/…) o una dirección https://.");
const uuid = z.uuid({ error: "Elige una opción." });

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): boolean {
  return new Set(items.map(key)).size === items.length;
}

// -----------------------------------------------------------------------------
// Tema (store_themes.settings / draft_settings)
// -----------------------------------------------------------------------------

const colors = z.strictObject(
  Object.fromEntries(COLOR_KEYS.map((k) => [k, hex.optional()])) as Record<
    (typeof COLOR_KEYS)[number],
    z.ZodOptional<typeof hex>
  >,
);

const announcement = z.strictObject({
  text: text(1, 120),
  link: link.optional(),
  background: hex,
  foreground: hex,
});

export const ThemeSettingsV1 = z.strictObject({
  colors: colors.optional(),
  typography: z
    .strictObject({ heading: z.enum(FONT_KEYS).optional(), body: z.enum(FONT_KEYS).optional() })
    .optional(),
  shape: z
    .strictObject({
      radius: z.enum(["none", "sm", "md", "full"]).optional(),
      button_style: z.enum(["solid", "outline"]).optional(),
    })
    .optional(),
  header: z
    .strictObject({
      logo_position: z.enum(["left", "center"]).optional(),
      announcement: announcement.optional(),
    })
    .optional(),
  footer: z
    .strictObject({
      legal_text: text(1, 500, true).optional(),
      payment_methods: z
        .array(z.enum(PAYMENT_METHODS))
        .max(PAYMENT_METHODS.length)
        .refine((l) => uniqueBy(l, (m) => m), "Un medio de pago está repetido.")
        .optional(),
    })
    .optional(),
  social: z
    .array(
      z
        .strictObject({ network: z.enum(SOCIAL_NETWORKS), url: z.string() })
        .refine((s) => isValidSocialUrl(s.network, s.url), {
          message: "La dirección debe ser https:// de esa red social.",
          path: ["url"],
        }),
    )
    .max(SOCIAL_NETWORKS.length)
    .refine((l) => uniqueBy(l, (s) => s.network), "Una red social está repetida.")
    .optional(),
  seo: z
    .strictObject({
      title: text(1, 70).optional(),
      description: text(1, 160).optional(),
      image_media_id: uuid.optional(),
    })
    .optional(),
  contact: z
    .strictObject({
      whatsapp: z
        .string()
        .regex(/^\+[1-9][0-9]{7,14}$/, "Usa el formato internacional, por ejemplo +525512345678.")
        .optional(),
      address: text(1, 300, true).optional(),
      hours: text(1, 200, true).optional(),
    })
    .optional(),
});
export type ThemeSettings = z.infer<typeof ThemeSettingsV1>;

// -----------------------------------------------------------------------------
// Portada (store_themes.home_sections / draft_home_sections)
// -----------------------------------------------------------------------------

const cta = z.strictObject({ label: text(1, 30), link });

const hero = z.strictObject({
  heading: text(1, 80),
  subheading: text(1, 200).optional(),
  image_media_id: uuid.optional(),
  cta: cta.optional(),
  align: z.enum(["left", "center"]),
});

const productSource = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("newest") }),
  z.strictObject({ type: z.literal("best_selling") }),
  z.strictObject({ type: z.literal("category"), id: uuid }),
  z.strictObject({ type: z.literal("brand"), id: uuid }),
  z.strictObject({ type: z.literal("attribute_value"), id: uuid }),
]);

const featuredProducts = z.strictObject({
  title: text(1, 60),
  source: productSource,
  limit: z
    .int({ error: "Usa un número entero de 4 a 12." })
    .min(4, "Muestra al menos 4 productos.")
    .max(12, "Muestra hasta 12 productos."),
  show_view_all: z.boolean(),
});

const categoryGrid = z.strictObject({
  title: text(1, 60),
  category_ids: z
    .array(uuid)
    .min(1)
    .max(12)
    .refine((l) => uniqueBy(l, (id) => id.toLowerCase()), "Una categoría está repetida.")
    .optional(),
});

const promoBanner = z.strictObject({
  image_media_id: uuid,
  heading: text(1, 80).optional(),
  text: text(1, 200).optional(),
  cta: cta.optional(),
});

const imageWithText = z.strictObject({
  image_media_id: uuid,
  heading: text(1, 80),
  body: text(1, 600, true),
  cta: cta.optional(),
  image_position: z.enum(["left", "right"]),
});

const brandLogos = z.strictObject({
  title: text(1, 60),
  brand_ids: z
    .array(uuid)
    .min(2)
    .max(12)
    .refine((l) => uniqueBy(l, (id) => id.toLowerCase()), "Una marca está repetida."),
});

const testimonials = z.strictObject({
  title: text(1, 60),
  items: z
    .array(
      z.strictObject({
        quote: text(1, 300, true),
        author: text(1, 60),
        detail: text(1, 60).optional(),
      }),
    )
    .min(1)
    .max(6),
});

const richText = z.strictObject({
  heading: text(1, 80).optional(),
  html: z
    .string({ error: "Escribe el contenido." })
    .min(1, "Escribe el contenido.")
    .refine(
      (html) => new TextEncoder().encode(html).length <= MAX_RICH_TEXT_BYTES,
      "El contenido es demasiado largo.",
    ),
});

function section<T extends string, P extends z.ZodType>(type: T, props: P) {
  return z.strictObject({ id: uuid, type: z.literal(type), enabled: z.boolean(), props });
}

export const HomeSectionV1 = z.discriminatedUnion("type", [
  section("hero", hero),
  section("featured_products", featuredProducts),
  section("category_grid", categoryGrid),
  section("promo_banner", promoBanner),
  section("image_with_text", imageWithText),
  section("brand_logos", brandLogos),
  section("testimonials", testimonials),
  section("rich_text", richText),
]);
export type HomeSection = z.infer<typeof HomeSectionV1>;
export type HomeSectionType = HomeSection["type"];

export const HomeSectionsV1 = z
  .array(HomeSectionV1)
  .max(MAX_SECTIONS, `La portada admite hasta ${MAX_SECTIONS} secciones.`)
  .superRefine((sections, ctx) => {
    if (!uniqueBy(sections, (s) => s.id)) {
      ctx.addIssue({ code: "custom", message: "Una sección está repetida." });
    }
    const products = sections.filter((s) => s.type === "featured_products");
    if (products.length > MAX_PRODUCT_SECTIONS) {
      ctx.addIssue({
        code: "custom",
        message: `La portada admite hasta ${MAX_PRODUCT_SECTIONS} secciones de productos.`,
      });
    }
  });
