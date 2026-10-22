/**
 * Casos compartidos del Theme schema v2 (ADR-034; F9-DESIGN §2.2): el unit de Zod y la
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
    name: "barra de anuncio apagada (tema v3)",
    value: { header: { announcement: { ...bar, hidden: true } } },
    valid: true,
  },
  {
    name: "barra de anuncio con «hidden» que no es booleano",
    value: { header: { announcement: { ...bar, hidden: "no" } } },
    valid: false,
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
  // Tema v2 (ADR-034)
  { name: "v2 favicon", value: { favicon_media_id: id(5) }, valid: true },
  { name: "v2 favicon no uuid", value: { favicon_media_id: "logo.png" }, valid: false },
  {
    name: "v2 sombra y densidad",
    value: { shape: { shadow: "soft", density: "spacious" } },
    valid: true,
  },
  { name: "v2 sombra no válida", value: { shape: { shadow: "huge" } }, valid: false },
  { name: "v2 densidad no válida", value: { shape: { density: "tight" } }, valid: false },
  {
    name: "v2 anuncio con vigencia",
    value: {
      header: {
        announcement: {
          ...bar,
          starts_at: "2026-11-01T00:00:00-06:00",
          ends_at: "2026-11-30T23:59:00Z",
        },
      },
    },
    valid: true,
  },
  {
    name: "v2 anuncio con fracción de segundo",
    value: { header: { announcement: { ...bar, starts_at: "2026-11-01T08:30:00.123456+00:00" } } },
    valid: true,
  },
  {
    name: "v2 anuncio termina antes de empezar",
    value: {
      header: {
        announcement: { ...bar, starts_at: "2026-11-30T00:00Z", ends_at: "2026-11-01T00:00Z" },
      },
    },
    valid: false,
  },
  {
    name: "v2 anuncio que empieza y termina igual",
    value: {
      header: {
        announcement: { ...bar, starts_at: "2026-11-01T00:00Z", ends_at: "2026-11-01T00:00Z" },
      },
    },
    valid: false,
  },
  {
    name: "v2 anuncio: 10:00 en CDMX es después de 15:30 UTC",
    value: {
      header: {
        announcement: {
          ...bar,
          starts_at: "2026-11-01T10:00:00-06:00",
          ends_at: "2026-11-01T15:30:00Z",
        },
      },
    },
    valid: false,
  },
  {
    name: "v2 anuncio con 30 de febrero",
    value: { header: { announcement: { ...bar, starts_at: "2026-02-30T00:00Z" } } },
    valid: false,
  },
  {
    name: "v2 anuncio con 29 de febrero bisiesto",
    value: { header: { announcement: { ...bar, starts_at: "2028-02-29T00:00Z" } } },
    valid: true,
  },
  {
    name: "v2 anuncio sin zona",
    value: { header: { announcement: { ...bar, starts_at: "2026-11-01T00:00:00" } } },
    valid: false,
  },
  {
    name: "v2 anuncio solo fecha",
    value: { header: { announcement: { ...bar, ends_at: "2026-11-01" } } },
    valid: false,
  },
  {
    name: "v2 anuncio con hora 24",
    value: { header: { announcement: { ...bar, ends_at: "2026-11-01T24:00Z" } } },
    valid: false,
  },
  {
    name: "v2 4 accesos rápidos",
    value: {
      header: {
        quick_links: [
          { label: "Proteínas", link: "/categoria/proteinas" },
          { label: "Ofertas", link: "/ofertas" },
          { label: "Marcas", link: "/marcas" },
          { label: "Ayuda", link: "/paginas/contacto" },
        ],
      },
    },
    valid: true,
  },
  {
    name: "v2 5 accesos rápidos",
    value: {
      header: {
        quick_links: Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, link: "/" })),
      },
    },
    valid: false,
  },
  {
    name: "v2 acceso rápido de 21",
    value: { header: { quick_links: [{ label: "a".repeat(21), link: "/" }] } },
    valid: false,
  },
  {
    name: "v2 acceso rápido con javascript",
    value: { header: { quick_links: [{ label: "x", link: "javascript:alert(1)" }] } },
    valid: false,
  },
  {
    name: "v2 ficha y listado",
    value: {
      product_page: {
        gallery: "dots",
        show_price_per_serving: false,
        show_related: true,
        sticky_buy_bar: true,
      },
      listing: { columns_mobile: 1, show_brand: false },
    },
    valid: true,
  },
  {
    name: "v2 ficha con opción desconocida",
    value: { product_page: { hide_legal: true } },
    valid: false,
  },
  { name: "v2 listado de 3 columnas", value: { listing: { columns_mobile: 3 } }, valid: false },
  { name: "v2 listado con texto", value: { listing: { columns_mobile: "2" } }, valid: false },
  { name: "v2 listado 1.5", value: { listing: { columns_mobile: 1.5 } }, valid: false },
  { name: "v2 marca no booleana", value: { listing: { show_brand: "sí" } }, valid: false },
  // Tema v4.
  { name: "v4 color de oferta", value: { colors: { sale: "#b91c1c" } }, valid: true },
  { name: "v4 color de oferta mal escrito", value: { colors: { sale: "red" } }, valid: false },
  {
    name: "v4 colores por elemento",
    value: {
      element_colors: {
        hero: { background: "#111827", foreground: "#ffffff" },
        nav_bar: {
          background: "#ffffff",
          foreground: "#111827",
          active: "#1d4ed8",
          border: "#e5e7eb",
        },
        footer: { background: "#111827", foreground: "#ffffff" },
      },
    },
    valid: true,
  },
  {
    name: "v4 elemento desconocido",
    value: { element_colors: { sidebar: { background: "#ffffff", foreground: "#111827" } } },
    valid: false,
  },
  {
    name: "v4 activo solo en la barra",
    value: {
      element_colors: { hero: { background: "#ffffff", foreground: "#111827", active: "#000000" } },
    },
    valid: false,
  },
  {
    name: "v4 elemento sin texto",
    value: { element_colors: { header: { background: "#ffffff" } } },
    valid: false,
  },
  {
    name: "v4 barra de categorías completa",
    value: {
      header: {
        nav_bar: {
          items: [
            { label: "Todos", link: "/productos" },
            { label: "Energía", link: "/categoria/energia", visibility: "mobile" },
          ],
          style: "pills",
          sticky: true,
          align: "center",
          size: "md",
          visibility: "all",
        },
      },
    },
    valid: true,
  },
  { name: "v4 barra vacía", value: { header: { nav_bar: {} } }, valid: true },
  {
    name: "v4 barra con estilo desconocido",
    value: { header: { nav_bar: { style: "tabs" } } },
    valid: false,
  },
  {
    name: "v4 barra con enlace javascript",
    value: { header: { nav_bar: { items: [{ label: "x", link: "javascript:alert(1)" }] } } },
    valid: false,
  },
  {
    name: "v4 barra con nombre largo",
    value: { header: { nav_bar: { items: [{ label: "x".repeat(31), link: "/" }] } } },
    valid: false,
  },
  {
    name: "v4 barra con 13 enlaces",
    value: {
      header: {
        nav_bar: { items: Array.from({ length: 13 }, (_, n) => ({ label: `L${n}`, link: "/" })) },
      },
    },
    valid: false,
  },
  {
    name: "v4 barra con clave extra",
    value: { header: { nav_bar: { items: [{ label: "x", link: "/", icon: "star" }] } } },
    valid: false,
  },
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
  // Tema v3 (misión Portada/Marcas): imagen del celular, foto de fondo y portadas que rotan.
  {
    name: "hero v3 completo",
    value: [
      sec(1, "hero", {
        heading: "Hola",
        align: "left",
        image_media_id: id(9),
        mobile_image_media_id: id(8),
        layout: "background",
        autoplay: true,
        slides: [
          {
            heading: "Segunda",
            subheading: "Sub",
            image_media_id: id(7),
            mobile_image_media_id: id(6),
          },
          { heading: "Tercera", cta: { label: "Ver", link: "/ofertas" } },
        ],
      }),
    ],
    valid: true,
  },
  {
    name: "hero con presentación desconocida",
    value: [sec(1, "hero", { heading: "Hola", align: "left", layout: "full" })],
    valid: false,
  },
  {
    name: "hero con 4 portadas extra",
    value: [
      sec(1, "hero", {
        heading: "Hola",
        align: "left",
        slides: [1, 2, 3, 4].map((n) => ({ heading: `P${n}` })),
      }),
    ],
    valid: false,
  },
  {
    name: "hero con lista de portadas vacía",
    value: [sec(1, "hero", { heading: "Hola", align: "left", slides: [] })],
    valid: false,
  },
  {
    name: "portada extra sin título",
    value: [sec(1, "hero", { heading: "Hola", align: "left", slides: [{ subheading: "x" }] })],
    valid: false,
  },
  {
    name: "portada extra con campo desconocido",
    value: [
      sec(1, "hero", { heading: "Hola", align: "left", slides: [{ heading: "x", color: "#fff" }] }),
    ],
    valid: false,
  },
  {
    name: "hero con autoplay que no es booleano",
    value: [sec(1, "hero", { heading: "Hola", align: "left", autoplay: "sí" })],
    valid: false,
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
  { name: "tipo desconocido", value: [sec(1, "iframe", { url: "https://x.com" })], valid: false },
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
    name: "20 bloques",
    value: Array.from({ length: 20 }, (_, i) => sec(i + 1, "rich_text", { html: "<p>x</p>" })),
    valid: true,
  },
  {
    name: "21 bloques",
    value: Array.from({ length: 21 }, (_, i) => sec(i + 1, "rich_text", { html: "<p>x</p>" })),
    valid: false,
  },
  // Bloques v2 (ADR-034)
  {
    name: "v2 preguntas frecuentes",
    value: [
      sec(1, "faq", {
        title: "Preguntas",
        items: [{ question: "¿Envían a todo México?", answer: "Sí.\nEn 2 a 5 días." }],
      }),
    ],
    valid: true,
  },
  {
    name: "v2 13 preguntas",
    value: [
      sec(1, "faq", {
        title: "Preguntas",
        items: Array.from({ length: 13 }, () => ({ question: "q", answer: "a" })),
      }),
    ],
    valid: false,
  },
  {
    name: "v2 pregunta de 151",
    value: [sec(1, "faq", { title: "P", items: [{ question: "a".repeat(151), answer: "a" }] })],
    valid: false,
  },
  {
    name: "v2 beneficios",
    value: [
      sec(1, "benefits", {
        items: [
          { icon: "truck", title: "Envío gratis", text: "Desde $999" },
          { icon: "lab", title: "Probado" },
        ],
      }),
    ],
    valid: true,
  },
  {
    name: "v2 beneficio con ícono propio",
    value: [sec(1, "benefits", { items: [{ icon: "<svg>", title: "x" }] })],
    valid: false,
  },
  {
    name: "v2 7 beneficios",
    value: [
      sec(1, "benefits", {
        items: Array.from({ length: 7 }, () => ({ icon: "star", title: "x" })),
      }),
    ],
    valid: false,
  },
  {
    name: "v2 objetivos",
    value: [sec(1, "goals", { title: "Tu objetivo", value_ids: [id(30), id(31)] })],
    valid: true,
  },
  {
    name: "v2 objetivos vacíos",
    value: [sec(1, "goals", { title: "Tu objetivo", value_ids: [] })],
    valid: false,
  },
  {
    name: "v2 objetivo repetido",
    value: [sec(1, "goals", { title: "Tu objetivo", value_ids: [id(30), id(30)] })],
    valid: false,
  },
  {
    name: "v2 opiniones",
    value: [sec(1, "reviews", { title: "Lo que dicen", limit: 3 })],
    valid: true,
  },
  {
    name: "v2 opiniones con texto propio",
    value: [sec(1, "reviews", { title: "x", limit: 3, items: [{ quote: "Excelente" }] })],
    valid: false,
  },
  { name: "v2 2 opiniones", value: [sec(1, "reviews", { title: "x", limit: 2 })], valid: false },
  {
    name: "v2 video de YouTube",
    value: [
      sec(1, "video", { provider: "youtube", video_id: "dQw4w9WgXcQ", title: "Cómo se usa" }),
    ],
    valid: true,
  },
  {
    name: "v2 video de Vimeo",
    value: [
      sec(1, "video", {
        provider: "vimeo",
        video_id: "76979871",
        title: "Fábrica",
        caption: "Así se hace",
      }),
    ],
    valid: true,
  },
  {
    name: "v2 video con URL en vez de código",
    value: [
      sec(1, "video", {
        provider: "youtube",
        video_id: "https://youtu.be/dQw4w9WgXcQ",
        title: "x",
      }),
    ],
    valid: false,
  },
  {
    name: "v2 video de Vimeo con letras",
    value: [sec(1, "video", { provider: "vimeo", video_id: "abc12345", title: "x" })],
    valid: false,
  },
  {
    name: "v2 video de otro sitio",
    value: [sec(1, "video", { provider: "tiktok", video_id: "123456789", title: "x" })],
    valid: false,
  },
  {
    name: "v2 video sin título",
    value: [sec(1, "video", { provider: "youtube", video_id: "dQw4w9WgXcQ" })],
    valid: false,
  },
  {
    name: "v2 contacto",
    value: [sec(1, "contact_map", { title: "Visítanos", show_whatsapp: true })],
    valid: true,
  },
  {
    name: "v2 contacto con mapa incrustado",
    value: [
      sec(1, "contact_map", {
        title: "x",
        show_whatsapp: false,
        embed: "https://maps.google.com",
      }),
    ],
    valid: false,
  },
  {
    name: "v2 productos elegidos a mano en carrusel",
    value: [
      sec(1, "featured_products", {
        title: "Favoritos",
        source: { type: "manual", product_ids: [id(40), id(41)] },
        limit: 4,
        show_view_all: false,
        layout: "carousel",
      }),
    ],
    valid: true,
  },
  {
    name: "v2 13 productos elegidos",
    value: [
      products(1, 8, {
        type: "manual",
        product_ids: Array.from({ length: 13 }, (_, i) => id(100 + i)),
      }),
    ],
    valid: false,
  },
  {
    name: "v2 producto elegido repetido",
    value: [products(1, 8, { type: "manual", product_ids: [id(40), id(40)] })],
    valid: false,
  },
  {
    name: "v2 elegidos sin productos",
    value: [products(1, 8, { type: "manual", product_ids: [] })],
    valid: false,
  },
  {
    name: "v2 diseño no válido",
    value: [sec(1, "category_grid", { title: "Categorías", layout: "masonry" })],
    valid: false,
  },
  {
    name: "v2 categorías en carrusel",
    value: [sec(1, "category_grid", { title: "Categorías", layout: "carousel" })],
    valid: true,
  },
  {
    name: "v2 solo en el celular y con vigencia",
    value: [
      {
        ...sec(1, "hero", { heading: "Buen Fin", align: "center" }),
        visibility: "mobile",
        starts_at: "2026-11-13T00:00:00-06:00",
        ends_at: "2026-11-17T23:59:59-06:00",
      },
    ],
    valid: true,
  },
  {
    name: "v2 visibilidad no válida",
    value: [{ ...sec(1, "hero", { heading: "a", align: "center" }), visibility: "tablet" }],
    valid: false,
  },
  {
    name: "v2 bloque que termina antes de empezar",
    value: [
      {
        ...sec(1, "hero", { heading: "a", align: "center" }),
        starts_at: "2026-11-17T00:00Z",
        ends_at: "2026-11-13T00:00Z",
      },
    ],
    valid: false,
  },
  {
    name: "v2 bloque con fecha inválida",
    value: [{ ...sec(1, "hero", { heading: "a", align: "center" }), ends_at: "2026-13-01T00:00Z" }],
    valid: false,
  },
  {
    name: "v2 bloque con clave desconocida",
    value: [{ ...sec(1, "hero", { heading: "a", align: "center" }), css: "color:red" }],
    valid: false,
  },
  // Tema v4.
  {
    name: "v4 bloque con colores y espaciado",
    value: [
      {
        ...sec(1, "hero", { heading: "a", align: "center" }),
        colors: { background: "#111827", foreground: "#ffffff" },
        spacing: "spacious",
      },
    ],
    valid: true,
  },
  {
    name: "v4 bloque con texto ilegible",
    value: [
      {
        ...sec(1, "hero", { heading: "a", align: "center" }),
        colors: { background: "#ffffff", foreground: "#eeeeee" },
      },
    ],
    valid: false,
  },
  {
    name: "v4 bloque con un solo color",
    value: [
      { ...sec(1, "hero", { heading: "a", align: "center" }), colors: { background: "#ffffff" } },
    ],
    valid: false,
  },
  {
    name: "v4 espaciado desconocido",
    value: [{ ...sec(1, "hero", { heading: "a", align: "center" }), spacing: "huge" }],
    valid: false,
  },
];
