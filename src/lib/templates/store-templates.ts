import type { Palette } from "@/lib/theme/palette";
import type { HomeSection, ThemeSettings } from "@/lib/theme/schema";

/**
 * Plantillas de tienda por giro (ADR-034 §5). Una plantilla es un punto de
 * partida: estilo, portada, categorías y productos de ejemplo. Se aplica al
 * BORRADOR con `store_apply_template`, que marca cada producto como ejemplo
 * («Ejemplo · », etiqueta `ejemplo`, en borrador) y bloquea el lanzamiento
 * mientras exista alguno. Sin imágenes: la tienda sube las suyas.
 *
 * Los textos no prometen efectos ni resultados (cumplimiento, Fase R): describen
 * el producto y piden a la tienda que los reemplace.
 */

export interface TemplateVariant {
  options?: Record<string, string>;
  /** Centavos (GATE0 §44.14). */
  price: number;
  compare_at_price?: number;
  net_content?: string;
  servings_per_container?: number;
}

export interface TemplateProduct {
  title: string;
  /** Slug de una categoría de la misma plantilla. */
  category: string;
  /** Texto plano; la base lo envuelve en un párrafo. */
  description: string;
  options?: { name: string; values: string[] }[];
  variants: TemplateVariant[];
}

export interface StoreTemplate {
  key: "suplementos" | "ropa" | "belleza" | "abarrotes" | "generica" | "blanco";
  name: string;
  description: string;
  colors: Palette;
  settings: ThemeSettings;
  home_sections: HomeSection[];
  categories: { name: string; slug: string; description?: string }[];
  products: TemplateProduct[];
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const faqShipping = (n: number): HomeSection => ({
  id: id(n),
  type: "faq",
  enabled: true,
  props: {
    title: "Preguntas frecuentes",
    items: [
      {
        question: "¿Cuánto tarda mi envío?",
        answer: "Escribe aquí tus tiempos de entrega reales por zona.",
      },
      {
        question: "¿Cómo puedo pagar?",
        answer: "Escribe aquí los métodos de pago que aceptas.",
      },
      {
        question: "¿Puedo devolver un producto?",
        answer: "Resume aquí tu política de devoluciones y enlaza la página completa.",
      },
    ],
  },
});

const categoryGrid = (n: number, title: string): HomeSection => ({
  id: id(n),
  type: "category_grid",
  enabled: true,
  props: { title },
});

const newest = (n: number, title: string, layout: "grid" | "carousel" = "grid"): HomeSection => ({
  id: id(n),
  type: "featured_products",
  enabled: true,
  props: { title, source: { type: "newest" }, limit: 8, show_view_all: true, layout },
});

const reviews = (n: number): HomeSection => ({
  id: id(n),
  type: "reviews",
  enabled: true,
  props: { title: "Lo que dicen nuestros clientes", limit: 6 },
});

const contact = (n: number): HomeSection => ({
  id: id(n),
  type: "contact_map",
  enabled: true,
  props: { title: "Visítanos o escríbenos", show_whatsapp: true },
});

const SUPLEMENTOS: StoreTemplate = {
  key: "suplementos",
  name: "Suplementos",
  description: "Proteínas, creatinas y vitaminas con precio por porción y ficha del producto.",
  colors: {
    primary: "#0b5d4b",
    accent: "#b4500c",
    background: "#fbfaf7",
    foreground: "#14181f",
    muted: "#4a5260",
  },
  settings: {
    typography: { heading: "barlow-condensed", body: "inter" },
    shape: { radius: "sm", button_style: "solid", shadow: "soft", density: "comfortable" },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Suplementos para tu rutina",
        subheading: "Escribe aquí en una frase qué te distingue.",
        cta: { label: "Ver productos", link: "/productos" },
        align: "left",
      },
    },
    {
      id: id(2),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "truck", title: "Envíos a todo México" },
          { icon: "shield", title: "Pago seguro" },
          { icon: "chat", title: "Atención por WhatsApp" },
        ],
      },
    },
    categoryGrid(3, "Compra por categoría"),
    newest(4, "Lo más nuevo", "carousel"),
    reviews(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Proteínas", slug: "proteinas" },
    { name: "Creatinas", slug: "creatinas" },
    { name: "Vitaminas", slug: "vitaminas" },
    { name: "Preentrenos", slug: "preentrenos" },
  ],
  products: [
    {
      title: "Proteína de suero 1 kg",
      category: "proteinas",
      description: "Polvo para preparar con agua o leche. Reemplaza este texto con la ficha real.",
      options: [{ name: "Sabor", values: ["Vainilla", "Chocolate"] }],
      variants: [
        {
          options: { Sabor: "Vainilla" },
          price: 89900,
          net_content: "1 kg",
          servings_per_container: 30,
        },
        {
          options: { Sabor: "Chocolate" },
          price: 89900,
          compare_at_price: 99900,
          net_content: "1 kg",
          servings_per_container: 30,
        },
      ],
    },
    {
      title: "Creatina monohidratada 300 g",
      category: "creatinas",
      description: "Polvo sin sabor. Reemplaza este texto con la ficha real.",
      variants: [{ price: 49900, net_content: "300 g", servings_per_container: 60 }],
    },
    {
      title: "Multivitamínico 60 cápsulas",
      category: "vitaminas",
      description: "Frasco con 60 cápsulas. Reemplaza este texto con la ficha real.",
      variants: [{ price: 29900, net_content: "60 cápsulas", servings_per_container: 60 }],
    },
    {
      title: "Preentreno 300 g",
      category: "preentrenos",
      description: "Polvo para preparar con agua. Reemplaza este texto con la ficha real.",
      options: [{ name: "Sabor", values: ["Frutos rojos", "Limón"] }],
      variants: [
        { options: { Sabor: "Frutos rojos" }, price: 59900, net_content: "300 g" },
        { options: { Sabor: "Limón" }, price: 59900, net_content: "300 g" },
      ],
    },
  ],
};

const ROPA: StoreTemplate = {
  key: "ropa",
  name: "Ropa",
  description: "Prendas con tallas y colores, portada de temporada y listado a una columna.",
  colors: {
    primary: "#2b2d42",
    accent: "#9a3412",
    background: "#fafaf9",
    foreground: "#1c1917",
    muted: "#57534e",
  },
  settings: {
    listing: { columns_mobile: 1, show_brand: false },
    typography: { heading: "playfair-display", body: "work-sans" },
    shape: { radius: "none", button_style: "solid", shadow: "none", density: "spacious" },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Nueva temporada",
        subheading: "Escribe aquí la frase de tu colección.",
        cta: { label: "Ver la colección", link: "/productos" },
        align: "center",
      },
    },
    categoryGrid(2, "Compra por categoría"),
    newest(3, "Recién llegado"),
    {
      id: id(4),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "return", title: "Cambios de talla" },
          { icon: "truck", title: "Envíos a todo México" },
          { icon: "card", title: "Paga como prefieras" },
        ],
      },
    },
    faqShipping(5),
  ],
  categories: [
    { name: "Playeras", slug: "playeras" },
    { name: "Pantalones", slug: "pantalones" },
    { name: "Sudaderas", slug: "sudaderas" },
    { name: "Accesorios", slug: "accesorios" },
  ],
  products: [
    {
      title: "Playera básica de algodón",
      category: "playeras",
      description: "Corte recto, cuello redondo. Reemplaza este texto con tu descripción.",
      options: [
        { name: "Talla", values: ["CH", "M", "G"] },
        { name: "Color", values: ["Blanco", "Negro"] },
      ],
      variants: ["CH", "M", "G"].flatMap((talla) =>
        ["Blanco", "Negro"].map((color) => ({
          options: { Talla: talla, Color: color },
          price: 29900,
        })),
      ),
    },
    {
      title: "Pantalón de mezclilla",
      category: "pantalones",
      description: "Corte recto, mezclilla rígida. Reemplaza este texto con tu descripción.",
      options: [{ name: "Talla", values: ["28", "30", "32", "34"] }],
      variants: ["28", "30", "32", "34"].map((talla) => ({
        options: { Talla: talla },
        price: 69900,
      })),
    },
    {
      title: "Sudadera con capucha",
      category: "sudaderas",
      description: "Felpa por dentro. Reemplaza este texto con tu descripción.",
      options: [{ name: "Talla", values: ["CH", "M", "G"] }],
      variants: ["CH", "M", "G"].map((talla) => ({
        options: { Talla: talla },
        price: 79900,
        compare_at_price: 89900,
      })),
    },
    {
      title: "Gorra de gabardina",
      category: "accesorios",
      description: "Ajustable. Reemplaza este texto con tu descripción.",
      variants: [{ price: 24900 }],
    },
  ],
};

const BELLEZA: StoreTemplate = {
  key: "belleza",
  name: "Belleza",
  description: "Cuidado de la piel y maquillaje con tonos, rutina en video y preguntas frecuentes.",
  colors: {
    primary: "#8a2c55",
    accent: "#a1401c",
    background: "#fffaf8",
    foreground: "#2a1a20",
    muted: "#6b5560",
  },
  settings: {
    typography: { heading: "lora", body: "dm-sans" },
    shape: { radius: "full", button_style: "solid", shadow: "soft", density: "spacious" },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Tu rutina, a tu manera",
        subheading: "Escribe aquí qué hace especial a tu marca.",
        cta: { label: "Comprar ahora", link: "/productos" },
        align: "center",
      },
    },
    categoryGrid(2, "Encuentra lo tuyo"),
    newest(3, "Favoritos de la casa", "carousel"),
    {
      id: id(4),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "leaf", title: "Ingredientes claros" },
          { icon: "gift", title: "Empaque para regalo" },
          { icon: "chat", title: "Te asesoramos" },
        ],
      },
    },
    reviews(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Cuidado de la piel", slug: "cuidado-de-la-piel" },
    { name: "Maquillaje", slug: "maquillaje" },
    { name: "Cabello", slug: "cabello" },
  ],
  products: [
    {
      title: "Crema hidratante 50 ml",
      category: "cuidado-de-la-piel",
      description: "Textura ligera para uso diario. Reemplaza este texto con tu descripción.",
      variants: [{ price: 34900, net_content: "50 ml" }],
    },
    {
      title: "Labial mate",
      category: "maquillaje",
      description: "Acabado mate. Reemplaza este texto con tu descripción.",
      options: [{ name: "Tono", values: ["Rosa", "Rojo", "Nude"] }],
      variants: ["Rosa", "Rojo", "Nude"].map((tono) => ({ options: { Tono: tono }, price: 19900 })),
    },
    {
      title: "Shampoo sin sulfatos 400 ml",
      category: "cabello",
      description: "Para todo tipo de cabello. Reemplaza este texto con tu descripción.",
      variants: [{ price: 24900, compare_at_price: 27900, net_content: "400 ml" }],
    },
  ],
};

const ABARROTES: StoreTemplate = {
  key: "abarrotes",
  name: "Abarrotes",
  description:
    "Despensa por pasillos, compra rápida a dos columnas y datos de contacto a la vista.",
  colors: {
    primary: "#1f6b2e",
    accent: "#c2410c",
    background: "#ffffff",
    foreground: "#1a1c1e",
    muted: "#545b62",
  },
  settings: {
    listing: { columns_mobile: 2, show_brand: true },
    typography: { heading: "manrope", body: "inter" },
    shape: { radius: "md", button_style: "solid", shadow: "none", density: "compact" },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Tu despensa a domicilio",
        subheading: "Escribe aquí tu zona de entrega y horario.",
        cta: { label: "Hacer mi pedido", link: "/productos" },
        align: "left",
      },
    },
    categoryGrid(2, "Pasillos"),
    newest(3, "Para la despensa"),
    {
      id: id(4),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "clock", title: "Entrega el mismo día" },
          { icon: "card", title: "Efectivo o tarjeta" },
          { icon: "chat", title: "Pedidos por WhatsApp" },
        ],
      },
    },
    contact(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Despensa", slug: "despensa" },
    { name: "Bebidas", slug: "bebidas" },
    { name: "Limpieza", slug: "limpieza" },
    { name: "Botanas", slug: "botanas" },
  ],
  products: [
    {
      title: "Arroz 1 kg",
      category: "despensa",
      description: "Bolsa de 1 kg. Reemplaza este texto con tu descripción.",
      variants: [{ price: 3400, net_content: "1 kg" }],
    },
    {
      title: "Agua natural 1.5 l",
      category: "bebidas",
      description: "Botella de 1.5 litros. Reemplaza este texto con tu descripción.",
      variants: [{ price: 1800, net_content: "1.5 l" }],
    },
    {
      title: "Detergente líquido 1 l",
      category: "limpieza",
      description: "Botella de 1 litro. Reemplaza este texto con tu descripción.",
      variants: [{ price: 5900, compare_at_price: 6900, net_content: "1 l" }],
    },
    {
      title: "Papas fritas 170 g",
      category: "botanas",
      description: "Bolsa de 170 g. Reemplaza este texto con tu descripción.",
      variants: [{ price: 4200, net_content: "170 g" }],
    },
  ],
};

const GENERICA: StoreTemplate = {
  key: "generica",
  name: "Genérica",
  description: "Estructura sobria para cualquier giro: portada, categorías y preguntas frecuentes.",
  colors: {
    primary: "#1e3a5f",
    accent: "#b42318",
    background: "#ffffff",
    foreground: "#101828",
    muted: "#475467",
  },
  settings: {
    typography: { heading: "inter", body: "inter" },
    shape: { radius: "md", button_style: "solid", shadow: "soft", density: "comfortable" },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Bienvenido a nuestra tienda",
        subheading: "Escribe aquí en una frase qué vendes.",
        cta: { label: "Ver productos", link: "/productos" },
        align: "center",
      },
    },
    categoryGrid(2, "Categorías"),
    newest(3, "Productos"),
    faqShipping(4),
  ],
  categories: [
    { name: "Destacados", slug: "destacados" },
    { name: "Novedades", slug: "novedades" },
  ],
  products: [
    {
      title: "Producto A",
      category: "destacados",
      description: "Describe aquí tu producto.",
      variants: [{ price: 19900 }],
    },
    {
      title: "Producto B",
      category: "novedades",
      description: "Describe aquí tu producto.",
      variants: [{ price: 29900 }],
    },
  ],
};

/**
 * Punto de partida vacío: colores neutros, sin portada, categorías ni productos.
 * No declara ninguna categoría regulada, así que la tienda queda con el perfil
 * general hasta que la dueña declare una en Cumplimiento.
 */
const BLANCO: StoreTemplate = {
  key: "blanco",
  name: "En blanco",
  description: "Colores neutros y nada más: sin productos, categorías ni bloques de portada.",
  colors: {
    primary: "#101828",
    accent: "#344054",
    background: "#ffffff",
    foreground: "#101828",
    muted: "#475467",
  },
  settings: {
    typography: { heading: "inter", body: "inter" },
    shape: { radius: "sm", button_style: "solid", shadow: "none", density: "comfortable" },
  },
  home_sections: [],
  categories: [],
  products: [],
};

export const STORE_TEMPLATES: readonly StoreTemplate[] = [
  SUPLEMENTOS,
  ROPA,
  BELLEZA,
  ABARROTES,
  GENERICA,
  BLANCO,
];

export function findTemplate(key: string): StoreTemplate | undefined {
  return STORE_TEMPLATES.find((t) => t.key === key);
}

/** Lo que recibe `store_apply_template` (sin nombre ni descripción). */
export function templatePayload(t: StoreTemplate) {
  return {
    key: t.key,
    settings: { ...t.settings, colors: t.colors },
    home_sections: t.home_sections,
    categories: t.categories,
    products: t.products,
  };
}
