/**
 * Casos compartidos del Theme schema v1 (F9-DESIGN §2.2): el unit de Zod y la
 * prueba de paridad con la base (`tests/integration/theme-schema-parity.test.ts`)
 * corren exactamente estos. Uno por regla, en el borde válido y justo afuera.
 */

export interface SchemaCase {
  name: string;
  value: unknown;
  valid: boolean;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const emoji = "💪";

export const LINK_CASES: ReadonlyArray<{ value: string; valid: boolean }> = [
  { value: "/", valid: true },
  { value: "/productos?objetivo=energia&orden=nuevos", valid: true },
  { value: "/paginas/envios#tiempos", valid: true },
  { value: "https://example.com", valid: true },
  { value: "https://tienda.example.com.mx/promo?utm_source=x", valid: true },
  { value: "//evil.com", valid: false },
  { value: "/\\evil.com", valid: false },
  { value: "/%5cevil.com", valid: false },
  { value: "/%2F%2Fevil.com", valid: false },
  { value: "http://example.com", valid: false },
  { value: "javascript:alert(1)", valid: false },
  { value: "data:text/html,hi", valid: false },
  { value: "mailto:a@b.co", valid: false },
  { value: "https://user@example.com", valid: false },
  { value: "https://example.com:8443/x", valid: false },
  { value: "https://Example.com", valid: false },
  { value: "https://example.com.", valid: false },
  { value: "https://xn--80ak6aa92e.com", valid: true },
  { value: "https://exämple.com", valid: false },
  { value: "https://localhost", valid: false },
  { value: "https://example.com/a b", valid: false },
  { value: "/a b", valid: false },
  { value: "productos", valid: false },
  { value: "", valid: false },
  { value: `/${"a".repeat(499)}`, valid: true },
  { value: `/${"a".repeat(500)}`, valid: false },
];

export const SOCIAL_CASES: ReadonlyArray<{ network: string; url: string; valid: boolean }> = [
  { network: "instagram", url: "https://instagram.com/mitienda", valid: true },
  { network: "instagram", url: "https://www.instagram.com/mitienda", valid: true },
  { network: "instagram", url: "https://instagram.com.evil.com/x", valid: false },
  { network: "instagram", url: "https://evilinstagram.com/x", valid: false },
  { network: "instagram", url: "https://instagram.com@evil.com", valid: false },
  { network: "instagram", url: "http://instagram.com/x", valid: false },
  { network: "facebook", url: "https://fb.com/mitienda", valid: true },
  { network: "youtube", url: "https://youtu.be/abc", valid: true },
  { network: "x", url: "https://twitter.com/mitienda", valid: true },
  { network: "whatsapp", url: "https://wa.me/525512345678", valid: true },
  { network: "tiktok", url: "https://www.tiktok.com/@mitienda", valid: true },
  { network: "pinterest", url: "https://pin.it/abc", valid: true },
  { network: "linkedin", url: "https://linkedin.com/company/x", valid: true },
  { network: "linkedin", url: "https://instagram.com/x", valid: false },
];

const bar = { text: "Envío gratis desde $999", background: "#111827", foreground: "#ffffff" };

export const SETTINGS_CASES: ReadonlyArray<SchemaCase> = [
  { name: "vacío", value: {}, valid: true },
  {
    name: "lo que ya existía",
    value: { colors: { primary: "#1d4ed8" }, shape: { radius: "md", button_style: "solid" } },
    valid: true,
  },
  { name: "clave desconocida", value: { css: "body{}" }, valid: false },
  { name: "color en mayúsculas", value: { colors: { primary: "#1D4ED8" } }, valid: false },
  { name: "color desconocido", value: { colors: { link: "#000000" } }, valid: false },
  {
    name: "tipografía curada",
    value: { typography: { heading: "oswald", body: "inter" } },
    valid: true,
  },
  {
    name: "tipografía fuera de la lista",
    value: { typography: { heading: "comic-sans" } },
    valid: false,
  },
  { name: "radio no válido", value: { shape: { radius: "xl" } }, valid: false },
  { name: "logo centrado", value: { header: { logo_position: "center" } }, valid: true },
  { name: "logo a la derecha", value: { header: { logo_position: "right" } }, valid: false },
  {
    name: "barra de anuncio",
    value: { header: { announcement: { ...bar, link: "/productos" } } },
    valid: true,
  },
  {
    name: "barra de 120",
    value: { header: { announcement: { ...bar, text: "a".repeat(120) } } },
    valid: true,
  },
  {
    name: "barra de 121",
    value: { header: { announcement: { ...bar, text: "a".repeat(121) } } },
    valid: false,
  },
  {
    name: "barra con 120 emoji",
    value: { header: { announcement: { ...bar, text: emoji.repeat(120) } } },
    valid: true,
  },
  {
    name: "barra con 121 emoji",
    value: { header: { announcement: { ...bar, text: emoji.repeat(121) } } },
    valid: false,
  },
  {
    name: "barra sin recortar",
    value: { header: { announcement: { ...bar, text: " Hola" } } },
    valid: false,
  },
  {
    name: "barra con salto",
    value: { header: { announcement: { ...bar, text: "Hola\nmundo" } } },
    valid: false,
  },
  {
    name: "barra con tabulador",
    value: { header: { announcement: { ...bar, text: "Hola\tmundo" } } },
    valid: false,
  },
  {
    name: "barra sin colores",
    value: { header: { announcement: { text: "Hola" } } },
    valid: false,
  },
  {
    name: "barra con enlace javascript",
    value: { header: { announcement: { ...bar, link: "javascript:alert(1)" } } },
    valid: false,
  },
  {
    name: "barra con NBSP interno",
    value: { header: { announcement: { ...bar, text: "Envío gratis" } } },
    valid: true,
  },
  {
    name: "texto legal con saltos",
    value: { footer: { legal_text: "Línea 1\nLínea 2" } },
    valid: true,
  },
  {
    name: "texto legal con \\r",
    value: { footer: { legal_text: "Línea 1\r\nLínea 2" } },
    valid: false,
  },
  { name: "texto legal de 500", value: { footer: { legal_text: "a".repeat(500) } }, valid: true },
  { name: "texto legal de 501", value: { footer: { legal_text: "a".repeat(501) } }, valid: false },
  {
    name: "medios de pago",
    value: { footer: { payment_methods: ["visa", "oxxo", "spei"] } },
    valid: true,
  },
  {
    name: "medio de pago repetido",
    value: { footer: { payment_methods: ["visa", "visa"] } },
    valid: false,
  },
  {
    name: "medio de pago desconocido",
    value: { footer: { payment_methods: ["bitcoin"] } },
    valid: false,
  },
  {
    name: "redes",
    value: {
      social: [
        { network: "instagram", url: "https://instagram.com/x" },
        { network: "whatsapp", url: "https://wa.me/525512345678" },
      ],
    },
    valid: true,
  },
  {
    name: "red repetida",
    value: {
      social: [
        { network: "instagram", url: "https://instagram.com/x" },
        { network: "instagram", url: "https://instagram.com/y" },
      ],
    },
    valid: false,
  },
  {
    name: "red con dominio ajeno",
    value: { social: [{ network: "instagram", url: "https://evil.com/x" }] },
    valid: false,
  },
  {
    name: "red desconocida",
    value: { social: [{ network: "myspace", url: "https://myspace.com/x" }] },
    valid: false,
  },
  {
    name: "SEO",
    value: { seo: { title: "Mi tienda", description: "Suplementos", image_media_id: id(1) } },
    valid: true,
  },
  { name: "SEO título de 70", value: { seo: { title: "a".repeat(70) } }, valid: true },
  { name: "SEO título de 71", value: { seo: { title: "a".repeat(71) } }, valid: false },
  {
    name: "SEO descripción de 161",
    value: { seo: { description: "a".repeat(161) } },
    valid: false,
  },
  { name: "SEO imagen no uuid", value: { seo: { image_media_id: "x" } }, valid: false },
  {
    name: "SEO imagen uuid versión 0",
    value: { seo: { image_media_id: "00000000-0000-0000-8000-000000000001" } },
    valid: false,
  },
  {
    name: "SEO imagen uuid variante inválida",
    value: { seo: { image_media_id: "00000000-0000-4000-0000-000000000001" } },
    valid: false,
  },
  {
    name: "SEO imagen uuid en mayúsculas",
    value: { seo: { image_media_id: "0000000A-0000-4000-8000-00000000000B" } },
    valid: true,
  },
  { name: "SEO título vacío", value: { seo: { title: "" } }, valid: false },
  {
    name: "contacto",
    value: {
      contact: { whatsapp: "+525512345678", address: "Calle 1\nCDMX", hours: "L-V 9 a 18" },
    },
    valid: true,
  },
  { name: "WhatsApp sin +", value: { contact: { whatsapp: "5512345678" } }, valid: false },
  { name: "WhatsApp corto", value: { contact: { whatsapp: "+5212345" } }, valid: false },
  { name: "dirección de 301", value: { contact: { address: "a".repeat(301) } }, valid: false },
];

const sec = (n: number, type: string, props: unknown, enabled = true) => ({
  id: id(n),
  type,
  enabled,
  props,
});
const products = (n: number, limit = 8, source: unknown = { type: "newest" }) =>
  sec(n, "featured_products", { title: "Novedades", source, limit, show_view_all: true });

export const SECTIONS_CASES: ReadonlyArray<SchemaCase> = [
  { name: "vacía", value: [], valid: true },
  { name: "no es arreglo", value: {}, valid: false },
  {
    name: "hero mínimo",
    value: [sec(1, "hero", { heading: "Hola", align: "center" })],
    valid: true,
  },
  {
    name: "hero completo",
    value: [
      sec(1, "hero", {
        heading: "Hola",
        subheading: "Sub",
        image_media_id: id(9),
        cta: { label: "Comprar", link: "/productos" },
        align: "left",
      }),
    ],
    valid: true,
  },
  { name: "hero sin título", value: [sec(1, "hero", { align: "center" })], valid: false },
  {
    name: "hero título de 81",
    value: [sec(1, "hero", { heading: "a".repeat(81), align: "center" })],
    valid: false,
  },
  {
    name: "hero botón de 31",
    value: [
      sec(1, "hero", { heading: "a", align: "center", cta: { label: "a".repeat(31), link: "/" } }),
    ],
    valid: false,
  },
  {
    name: "hero enlace externo http",
    value: [
      sec(1, "hero", { heading: "a", align: "center", cta: { label: "Ir", link: "http://x.com" } }),
    ],
    valid: false,
  },
  {
    name: "hero prop desconocida",
    value: [sec(1, "hero", { heading: "a", align: "center", style: "color:red" })],
    valid: false,
  },
  { name: "tipo desconocido", value: [sec(1, "video", { url: "https://x.com" })], valid: false },
  {
    name: "id no uuid",
    value: [{ id: "1", type: "hero", enabled: true, props: { heading: "a", align: "center" } }],
    valid: false,
  },
  {
    name: "sin enabled",
    value: [{ id: id(1), type: "hero", props: { heading: "a", align: "center" } }],
    valid: false,
  },
  {
    name: "id repetido",
    value: [
      sec(1, "hero", { heading: "a", align: "center" }),
      sec(1, "rich_text", { html: "<p>x</p>" }),
    ],
    valid: false,
  },
  { name: "productos por novedades", value: [products(1)], valid: true },
  {
    name: "productos por atributo",
    value: [products(1, 8, { type: "attribute_value", id: id(5) })],
    valid: true,
  },
  {
    name: "productos por categoría sin id",
    value: [products(1, 8, { type: "category" })],
    valid: false,
  },
  {
    name: "productos novedades con id",
    value: [products(1, 8, { type: "newest", id: id(5) })],
    valid: false,
  },
  { name: "productos límite 3", value: [products(1, 3)], valid: false },
  { name: "productos límite 12", value: [products(1, 12)], valid: true },
  { name: "productos límite 13", value: [products(1, 13)], valid: false },
  { name: "productos límite decimal", value: [products(1, 8.5)], valid: false },
  {
    name: "4 secciones de productos",
    value: [products(1, 12), products(2, 12), products(3, 12), products(4, 12)],
    valid: true,
  },
  {
    name: "5 secciones de productos",
    value: [products(1, 4), products(2, 4), products(3, 4), products(4, 4), products(5, 4)],
    valid: false,
  },
  {
    name: "categorías raíz",
    value: [sec(1, "category_grid", { title: "Categorías" })],
    valid: true,
  },
  {
    name: "categorías repetidas",
    value: [sec(1, "category_grid", { title: "Categorías", category_ids: [id(2), id(2)] })],
    valid: false,
  },
  {
    // Gate F9 (G9-5): el mismo id en mayúsculas y minúsculas es el mismo.
    name: "categorías repetidas con distinta caja",
    value: [
      sec(1, "category_grid", {
        title: "Categorías",
        category_ids: [
          "aaaaaaaa-0000-4000-8000-000000000001",
          "AAAAAAAA-0000-4000-8000-000000000001",
        ],
      }),
    ],
    valid: false,
  },
  {
    name: "categorías lista vacía",
    value: [sec(1, "category_grid", { title: "Categorías", category_ids: [] })],
    valid: false,
  },
  {
    name: "banner",
    value: [
      sec(1, "promo_banner", {
        image_media_id: id(3),
        heading: "2x1",
        cta: { label: "Ver", link: "/productos" },
      }),
    ],
    valid: true,
  },
  { name: "banner sin imagen", value: [sec(1, "promo_banner", { heading: "2x1" })], valid: false },
  {
    name: "imagen con texto",
    value: [
      sec(1, "image_with_text", {
        image_media_id: id(3),
        heading: "Nosotros",
        body: "Párrafo 1\nPárrafo 2",
        image_position: "right",
      }),
    ],
    valid: true,
  },
  {
    name: "imagen con texto de 601",
    value: [
      sec(1, "image_with_text", {
        image_media_id: id(3),
        heading: "N",
        body: "a".repeat(601),
        image_position: "left",
      }),
    ],
    valid: false,
  },
  {
    name: "marcas",
    value: [sec(1, "brand_logos", { title: "Marcas", brand_ids: [id(2), id(3)] })],
    valid: true,
  },
  {
    name: "una sola marca",
    value: [sec(1, "brand_logos", { title: "Marcas", brand_ids: [id(2)] })],
    valid: false,
  },
  {
    name: "testimonios",
    value: [
      sec(1, "testimonials", {
        title: "Opiniones",
        items: [{ quote: "Muy buen servicio", author: "Ana" }],
      }),
    ],
    valid: true,
  },
  {
    name: "7 testimonios",
    value: [
      sec(1, "testimonials", {
        title: "Opiniones",
        items: Array.from({ length: 7 }, () => ({ quote: "q", author: "a" })),
      }),
    ],
    valid: false,
  },
  {
    name: "testimonio con calificación",
    value: [
      sec(1, "testimonials", {
        title: "Opiniones",
        items: [{ quote: "q", author: "a", rating: 5 }],
      }),
    ],
    valid: false,
  },
  {
    name: "texto enriquecido",
    value: [sec(1, "rich_text", { heading: "Envíos", html: "<p>Hola</p>" })],
    valid: true,
  },
  {
    name: "texto enriquecido de 20 000 bytes",
    value: [sec(1, "rich_text", { html: "a".repeat(20_000) })],
    valid: true,
  },
  {
    name: "texto enriquecido de 20 001 bytes",
    value: [sec(1, "rich_text", { html: "a".repeat(20_001) })],
    valid: false,
  },
  {
    name: "texto enriquecido multibyte",
    value: [sec(1, "rich_text", { html: "ñ".repeat(10_001) })],
    valid: false,
  },
  {
    name: "oculta",
    value: [sec(1, "hero", { heading: "a", align: "center" }, false)],
    valid: true,
  },
  {
    name: "12 secciones",
    value: Array.from({ length: 12 }, (_, i) => sec(i + 1, "rich_text", { html: "<p>x</p>" })),
    valid: true,
  },
  {
    name: "13 secciones",
    value: Array.from({ length: 13 }, (_, i) => sec(i + 1, "rich_text", { html: "<p>x</p>" })),
    valid: false,
  },
];
