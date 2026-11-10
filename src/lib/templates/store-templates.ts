import type { BenefitIcon } from "@/lib/theme/constants";
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
  key:
    | "suplementos"
    | "ropa"
    | "belleza"
    | "abarrotes"
    | "hogar"
    | "mascotas"
    | "joyeria"
    | "electronica"
    | "gourmet"
    | "juguetes"
    | "papeleria"
    | "regalos"
    | "generica"
    | "blanco";
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
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "raised",
      card_hover: "lift",
      heading_case: "uppercase",
      heading_tracking: "tight",
      heading_weight: "bold",
      type_scale: "large",
      motion: "subtle",
    },
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
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "flat",
      image_ratio: "3:4",
      image_fit: "cover",
      heading_case: "uppercase",
      heading_tracking: "wide",
      heading_weight: "regular",
      type_scale: "large",
      motion: "subtle",
    },
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
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "flat",
      image_ratio: "4:5",
      card_hover: "lift",
      card_align: "center",
      heading_weight: "regular",
      motion: "subtle",
    },
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
    // Personalidad (tema v5, ADR-063).
    personality: { card_hover: "none", heading_weight: "bold", type_scale: "compact" },
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

const HOGAR: StoreTemplate = {
  key: "hogar",
  name: "Hogar y decoración",
  description: "Piezas para la casa por espacio, con fotos grandes y una portada tranquila.",
  colors: {
    primary: "#1f4e5a",
    accent: "#8a4b14",
    background: "#f5f6f4",
    foreground: "#1d2421",
    muted: "#4f5a55",
  },
  settings: {
    listing: { columns_mobile: 2, show_brand: false },
    typography: { heading: "lora", body: "dm-sans" },
    shape: { radius: "md", button_style: "solid", shadow: "none", density: "spacious" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "flat",
      image_ratio: "4:5",
      image_fit: "cover",
      heading_weight: "regular",
      type_scale: "large",
      motion: "subtle",
    },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Hecho para quedarse",
        subheading: "Escribe aquí qué hace distinta a tu tienda.",
        cta: { label: "Ver la tienda", link: "/productos" },
        align: "left",
      },
    },
    categoryGrid(2, "Por espacio"),
    newest(3, "Recién llegado", "carousel"),
    {
      id: id(4),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "gift", title: "Envoltura para regalo" },
          { icon: "truck", title: "Envío bien empacado" },
          { icon: "return", title: "Cambios sin complicaciones" },
        ],
      },
    },
    faqShipping(5),
  ],
  categories: [
    { name: "Decoración", slug: "decoracion" },
    { name: "Cocina", slug: "cocina" },
    { name: "Velas y aromas", slug: "velas-y-aromas" },
    { name: "Textiles", slug: "textiles" },
    { name: "Plantas y macetas", slug: "plantas-y-macetas" },
  ],
  products: [
    {
      title: "Lámpara de mesa de cerámica",
      category: "decoracion",
      description:
        "Base de cerámica esmaltada y pantalla de tela. Reemplaza este texto con tu descripción.",
      variants: [{ price: 89900 }],
    },
    {
      title: "Juego de 4 tazas de barro",
      category: "cocina",
      description: "Barro vidriado, 300 ml cada una. Reemplaza este texto con tu descripción.",
      variants: [{ price: 45900, compare_at_price: 52900 }],
    },
    {
      title: "Vela aromática en vaso de vidrio",
      category: "velas-y-aromas",
      description: "Cera de soya en vaso reutilizable. Reemplaza este texto con tu descripción.",
      options: [{ name: "Aroma", values: ["Vainilla", "Lavanda"] }],
      variants: ["Vainilla", "Lavanda"].map((aroma) => ({
        options: { Aroma: aroma },
        price: 24900,
      })),
    },
    {
      title: "Funda de cojín de lino",
      category: "textiles",
      description: "45 × 45 cm, cierre oculto. Reemplaza este texto con tu descripción.",
      options: [{ name: "Color", values: ["Arena", "Gris"] }],
      variants: ["Arena", "Gris"].map((color) => ({ options: { Color: color }, price: 29900 })),
    },
    {
      title: "Maceta de barro con plato",
      category: "plantas-y-macetas",
      description:
        "Barro natural con orificio de drenaje. Reemplaza este texto con tu descripción.",
      options: [{ name: "Tamaño", values: ["Chica", "Mediana"] }],
      variants: [
        { options: { Tamaño: "Chica" }, price: 19900 },
        { options: { Tamaño: "Mediana" }, price: 27900 },
      ],
    },
  ],
};

const MASCOTAS: StoreTemplate = {
  key: "mascotas",
  name: "Mascotas",
  description: "Alimento, juguetes y accesorios por tipo de producto, con tallas por mascota.",
  colors: {
    primary: "#343a8f",
    accent: "#a63c0a",
    background: "#ffffff",
    foreground: "#1b1d33",
    muted: "#4a4f68",
  },
  settings: {
    listing: { columns_mobile: 2, show_brand: true },
    typography: { heading: "space-grotesk", body: "dm-sans" },
    shape: { radius: "full", button_style: "solid", shadow: "soft", density: "comfortable" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "raised",
      card_hover: "lift",
      card_align: "center",
      heading_tracking: "tight",
      heading_weight: "bold",
      motion: "subtle",
    },
  },
  home_sections: [
    {
      id: id(1),
      type: "hero",
      enabled: true,
      props: {
        heading: "Todo para tu compañero",
        subheading: "Escribe aquí qué ofreces y para qué mascotas.",
        cta: { label: "Comprar ahora", link: "/productos" },
        align: "left",
      },
    },
    categoryGrid(2, "¿Qué necesita hoy?"),
    newest(3, "Lo más nuevo"),
    {
      id: id(4),
      type: "benefits",
      enabled: true,
      props: {
        items: [
          { icon: "truck", title: "Entrega a domicilio" },
          { icon: "chat", title: "Te ayudamos a elegir" },
          { icon: "clock", title: "Pide lo de siempre en segundos" },
          { icon: "card", title: "Paga como prefieras" },
        ],
      },
    },
    reviews(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Alimento", slug: "alimento" },
    { name: "Juguetes", slug: "juguetes" },
    { name: "Collares y correas", slug: "collares-y-correas" },
    { name: "Camas", slug: "camas" },
  ],
  products: [
    {
      title: "Alimento seco para perro adulto",
      category: "alimento",
      description: "Croqueta mediana. Escribe aquí la marca e ingredientes reales.",
      options: [{ name: "Presentación", values: ["2 kg", "7 kg"] }],
      variants: [
        { options: { Presentación: "2 kg" }, price: 34900, net_content: "2 kg" },
        { options: { Presentación: "7 kg" }, price: 99900, net_content: "7 kg" },
      ],
    },
    {
      title: "Pelota de hule para perro",
      category: "juguetes",
      description: "Hule flexible, 7 cm. Reemplaza este texto con tu descripción.",
      variants: [{ price: 12900 }],
    },
    {
      title: "Collar ajustable de nylon",
      category: "collares-y-correas",
      description: "Hebilla de liberación rápida y argolla metálica. Reemplaza este texto.",
      options: [{ name: "Talla", values: ["CH", "M", "G"] }],
      variants: ["CH", "M", "G"].map((talla) => ({ options: { Talla: talla }, price: 17900 })),
    },
    {
      title: "Cama acolchada lavable",
      category: "camas",
      description: "Funda removible que se lava en lavadora. Reemplaza este texto.",
      options: [{ name: "Talla", values: ["M", "G"] }],
      variants: [
        { options: { Talla: "M" }, price: 64900, compare_at_price: 72900 },
        { options: { Talla: "G" }, price: 84900 },
      ],
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

// ---------------------------------------------------------------------------
// Segunda tanda de plantillas (plan 2026-11-05, fase A): cada una con su propia
// personalidad usando solo opciones que el tema ya admite (tipografías, forma,
// colores por elemento, barra de anuncio, barra de categorías, espaciado).
// ---------------------------------------------------------------------------

/** Mismo bloque con otro espacio arriba y abajo. */
const spaced = (s: HomeSection, spacing: "compact" | "normal" | "spacious"): HomeSection => ({
  ...s,
  spacing,
});

const benefits = (
  n: number,
  items: { icon: BenefitIcon; title: string; text?: string }[],
): HomeSection => ({ id: id(n), type: "benefits", enabled: true, props: { items } });

const heroBlock = (
  n: number,
  heading: string,
  subheading: string,
  cta: { label: string; link: string },
  align: "left" | "center",
): HomeSection => ({
  id: id(n),
  type: "hero",
  enabled: true,
  props: { heading, subheading, cta, align },
});

const best = (n: number, title: string): HomeSection => ({
  id: id(n),
  type: "featured_products",
  enabled: true,
  props: { title, source: { type: "best_selling" }, limit: 8, show_view_all: true, layout: "grid" },
});

const JOYERIA: StoreTemplate = {
  key: "joyeria",
  name: "Joyería y accesorios",
  description:
    "Elegancia discreta: marfil y negro con un toque dorado, títulos con serifa, botones de contorno y mucho aire.",
  colors: {
    primary: "#1c1917",
    accent: "#8a6a2f",
    background: "#faf8f5",
    foreground: "#1c1917",
    muted: "#57534e",
  },
  settings: {
    typography: { heading: "playfair-display", body: "manrope" },
    shape: { radius: "none", button_style: "outline", shadow: "none", density: "spacious" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "flat",
      image_ratio: "4:5",
      card_align: "center",
      heading_case: "uppercase",
      heading_tracking: "wide",
      heading_weight: "regular",
      type_scale: "large",
      motion: "subtle",
    },
    header: {
      logo_position: "center",
      announcement: {
        text: "Escribe aquí tu aviso de envíos o tu promoción",
        background: "#8a6a2f",
        foreground: "#ffffff",
      },
      nav_bar: { style: "text", align: "center", size: "md", sticky: false },
    },
    element_colors: {
      header: { background: "#1c1917", foreground: "#faf8f5" },
      footer: { background: "#1c1917", foreground: "#e7e5e4" },
    },
    product_page: { gallery: "thumbnails", show_related: true, sticky_buy_bar: false },
    listing: { columns_mobile: 2, show_brand: false },
  },
  home_sections: [
    spaced(
      heroBlock(
        1,
        "Piezas que se quedan contigo",
        "Escribe aquí la historia de tu marca en una frase.",
        { label: "Ver la colección", link: "/productos" },
        "center",
      ),
      "spacious",
    ),
    spaced(newest(2, "Recién llegadas", "carousel"), "spacious"),
    categoryGrid(3, "Compra por pieza"),
    benefits(4, [
      { icon: "gift", title: "Empaque para regalo" },
      { icon: "return", title: "Cambios y devoluciones" },
      { icon: "card", title: "Paga como prefieras" },
    ]),
    faqShipping(5),
    contact(6),
  ],
  categories: [
    { name: "Anillos", slug: "anillos" },
    { name: "Collares y dijes", slug: "collares-y-dijes" },
    { name: "Aretes", slug: "aretes" },
    { name: "Pulseras", slug: "pulseras" },
  ],
  products: [
    {
      title: "Anillo liso",
      category: "anillos",
      description: "Banda lisa. Reemplaza este texto con el material y las medidas reales.",
      options: [{ name: "Talla", values: ["5", "6", "7", "8"] }],
      variants: ["5", "6", "7", "8"].map((talla) => ({ options: { Talla: talla }, price: 59900 })),
    },
    {
      title: "Collar de cadena fina",
      category: "collares-y-dijes",
      description: "Cadena de 45 cm. Reemplaza este texto con el material real.",
      variants: [{ price: 79900 }],
    },
    {
      title: "Aretes de aro pequeño",
      category: "aretes",
      description: "Par de aros. Reemplaza este texto con el material real.",
      variants: [{ price: 39900, compare_at_price: 49900 }],
    },
    {
      title: "Pulsera ajustable",
      category: "pulseras",
      description: "Cierre ajustable. Reemplaza este texto con el material real.",
      variants: [{ price: 49900 }],
    },
  ],
};

const ELECTRONICA: StoreTemplate = {
  key: "electronica",
  name: "Electrónica y gadgets",
  description:
    "Tecnológica y directa: encabezado oscuro, azul eléctrico, tipografía geométrica y fichas con barra de compra fija.",
  colors: {
    primary: "#2740d6",
    accent: "#0e7490",
    background: "#f4f6f8",
    foreground: "#0f172a",
    muted: "#475569",
  },
  settings: {
    typography: { heading: "space-grotesk", body: "inter" },
    shape: { radius: "sm", button_style: "solid", shadow: "strong", density: "compact" },
    // Personalidad (tema v5, ADR-063).
    personality: { card_hover: "lift", heading_tracking: "tight", heading_weight: "semibold" },
    header: {
      logo_position: "left",
      announcement: {
        text: "Escribe aquí tu promoción o tu aviso de envíos",
        background: "#2740d6",
        foreground: "#ffffff",
      },
      nav_bar: { style: "pills", align: "start", size: "sm", sticky: true },
    },
    element_colors: {
      header: { background: "#0b1220", foreground: "#e6edf7" },
      nav_bar: { background: "#111a2e", foreground: "#e6edf7", active: "#7dd3fc" },
      footer: { background: "#0b1220", foreground: "#cbd5e1" },
    },
    product_page: { gallery: "thumbnails", show_related: true, sticky_buy_bar: true },
    listing: { columns_mobile: 2, show_brand: true },
  },
  home_sections: [
    heroBlock(
      1,
      "Tecnología para tu día a día",
      "Escribe aquí qué marcas y productos ofreces.",
      { label: "Ver productos", link: "/productos" },
      "left",
    ),
    best(2, "Lo más vendido"),
    categoryGrid(3, "Explora por categoría"),
    benefits(4, [
      { icon: "shield", title: "Pregunta por la garantía" },
      { icon: "truck", title: "Envíos a todo México" },
      { icon: "chat", title: "Atención por WhatsApp" },
    ]),
    reviews(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Audio", slug: "audio" },
    { name: "Cargadores y cables", slug: "cargadores-y-cables" },
    { name: "Accesorios para celular", slug: "accesorios-para-celular" },
    { name: "Hogar inteligente", slug: "hogar-inteligente" },
  ],
  products: [
    {
      title: "Audífonos inalámbricos",
      category: "audio",
      description: "Con estuche de carga. Reemplaza este texto con la ficha real.",
      options: [{ name: "Color", values: ["Negro", "Blanco"] }],
      variants: ["Negro", "Blanco"].map((color) => ({ options: { Color: color }, price: 79900 })),
    },
    {
      title: "Cargador de pared USB-C 20 W",
      category: "cargadores-y-cables",
      description: "Un puerto USB-C. Reemplaza este texto con la ficha real.",
      variants: [{ price: 29900 }],
    },
    {
      title: "Cable USB-C a USB-C 1 m",
      category: "cargadores-y-cables",
      description: "Cable trenzado de 1 metro. Reemplaza este texto con la ficha real.",
      variants: [{ price: 14900 }],
    },
    {
      title: "Soporte de escritorio para celular",
      category: "accesorios-para-celular",
      description: "Base ajustable. Reemplaza este texto con la ficha real.",
      variants: [{ price: 19900 }],
    },
    {
      title: "Foco inteligente Wi-Fi",
      category: "hogar-inteligente",
      description: "Foco de color regulable. Reemplaza este texto con la ficha real.",
      variants: [{ price: 24900 }],
    },
  ],
};

const GOURMET: StoreTemplate = {
  key: "gourmet",
  name: "Café y gourmet",
  description:
    "Cálida y artesanal: tonos café y crema, serifa en títulos y textos, esquinas suaves y pie oscuro.",
  colors: {
    primary: "#6b3a1e",
    accent: "#9a3412",
    background: "#fbf6ee",
    foreground: "#2a1d14",
    muted: "#6b5a4c",
  },
  settings: {
    typography: { heading: "playfair-display", body: "lora" },
    shape: { radius: "md", button_style: "solid", shadow: "soft", density: "comfortable" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "flat",
      image_ratio: "4:5",
      card_align: "center",
      heading_weight: "regular",
      type_scale: "large",
      motion: "subtle",
    },
    header: {
      logo_position: "center",
      announcement: {
        text: "Escribe aquí tus días de tueste y envío",
        background: "#6b3a1e",
        foreground: "#ffffff",
      },
      nav_bar: { style: "text", align: "center", size: "md", sticky: false },
    },
    element_colors: {
      footer: { background: "#2a1d14", foreground: "#f1e7d8" },
    },
    product_page: { gallery: "dots", show_related: true, sticky_buy_bar: false },
    listing: { columns_mobile: 2, show_brand: false },
  },
  home_sections: [
    spaced(
      heroBlock(
        1,
        "Del origen a tu mesa",
        "Escribe aquí de dónde vienen tus productos.",
        { label: "Ver la tienda", link: "/productos" },
        "center",
      ),
      "spacious",
    ),
    categoryGrid(2, "Nuestras selecciones"),
    newest(3, "Para esta semana", "carousel"),
    benefits(4, [
      { icon: "leaf", title: "Hecho en lotes pequeños" },
      { icon: "gift", title: "Cajas de regalo" },
      { icon: "truck", title: "Envíos a todo México" },
    ]),
    contact(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Café", slug: "cafe" },
    { name: "Té e infusiones", slug: "te-e-infusiones" },
    { name: "Dulces y chocolates", slug: "dulces-y-chocolates" },
    { name: "Despensa gourmet", slug: "despensa-gourmet" },
  ],
  products: [
    {
      title: "Café de especialidad 250 g",
      category: "cafe",
      description: "Bolsa de 250 g. Reemplaza este texto con el origen y el tueste reales.",
      options: [{ name: "Molienda", values: ["Grano", "Molido"] }],
      variants: ["Grano", "Molido"].map((molienda) => ({
        options: { Molienda: molienda },
        price: 18900,
        net_content: "250 g",
      })),
    },
    {
      title: "Té negro 20 sobres",
      category: "te-e-infusiones",
      description: "Caja con 20 sobres. Reemplaza este texto con tu descripción.",
      variants: [{ price: 9900, net_content: "20 sobres" }],
    },
    {
      title: "Chocolate amargo 100 g",
      category: "dulces-y-chocolates",
      description: "Barra de 100 g. Reemplaza este texto con tu descripción.",
      variants: [{ price: 8900, net_content: "100 g" }],
    },
    {
      title: "Mermelada artesanal 250 g",
      category: "despensa-gourmet",
      description: "Frasco de 250 g. Reemplaza este texto con tu descripción.",
      variants: [{ price: 12900, net_content: "250 g" }],
    },
  ],
};

const JUGUETES: StoreTemplate = {
  key: "juguetes",
  name: "Juguetes y bebés",
  description:
    "Alegre y redondeada: violeta y naranja, botones en píldora, barra de categorías en etiquetas y portada con fondo suave.",
  colors: {
    primary: "#6d28d9",
    accent: "#c2410c",
    background: "#fffdf7",
    foreground: "#1f2937",
    muted: "#4b5563",
  },
  settings: {
    typography: { heading: "montserrat", body: "dm-sans" },
    shape: { radius: "full", button_style: "solid", shadow: "soft", density: "comfortable" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "raised",
      card_hover: "lift",
      card_align: "center",
      heading_weight: "bold",
      type_scale: "large",
      motion: "subtle",
    },
    header: {
      logo_position: "left",
      announcement: {
        text: "Escribe aquí tu promoción o tus fechas de entrega",
        background: "#c2410c",
        foreground: "#ffffff",
      },
      nav_bar: { style: "pills", align: "start", size: "md", sticky: true },
    },
    element_colors: {
      hero: { background: "#ede9fe", foreground: "#2e1065" },
      nav_bar: { background: "#ffffff", foreground: "#1f2937", active: "#6d28d9" },
      footer: { background: "#2e1065", foreground: "#f5f3ff" },
    },
    product_page: { gallery: "thumbnails", show_related: true, sticky_buy_bar: true },
    listing: { columns_mobile: 2, show_brand: true },
  },
  home_sections: [
    heroBlock(
      1,
      "A jugar se ha dicho",
      "Escribe aquí para qué edades es tu tienda.",
      { label: "Ver juguetes", link: "/productos" },
      "center",
    ),
    categoryGrid(2, "Compra por edad o tipo"),
    newest(3, "Novedades"),
    benefits(4, [
      { icon: "gift", title: "Envoltura de regalo" },
      { icon: "truck", title: "Envíos a todo México" },
      { icon: "return", title: "Cambios y devoluciones" },
    ]),
    reviews(5),
    faqShipping(6),
  ],
  categories: [
    { name: "Juegos y didácticos", slug: "juegos-y-didacticos" },
    { name: "Peluches", slug: "peluches" },
    { name: "Bebés", slug: "bebes" },
    { name: "Fiesta y cumpleaños", slug: "fiesta-y-cumpleanos" },
  ],
  products: [
    {
      title: "Bloques de construcción 100 piezas",
      category: "juegos-y-didacticos",
      description: "Caja con 100 piezas. Reemplaza este texto con la edad recomendada real.",
      variants: [{ price: 29900 }],
    },
    {
      title: "Peluche mediano",
      category: "peluches",
      description: "Peluche de 30 cm. Reemplaza este texto con tu descripción.",
      options: [{ name: "Color", values: ["Beige", "Rosa", "Azul"] }],
      variants: ["Beige", "Rosa", "Azul"].map((color) => ({
        options: { Color: color },
        price: 24900,
      })),
    },
    {
      title: "Sonaja para bebé",
      category: "bebes",
      description: "Sonaja ligera. Reemplaza este texto con la edad recomendada real.",
      variants: [{ price: 8900 }],
    },
    {
      title: "Set de fiesta para 8 invitados",
      category: "fiesta-y-cumpleanos",
      description: "Platos, vasos y servilletas. Reemplaza este texto con el contenido real.",
      variants: [{ price: 17900 }],
    },
  ],
};

const PAPELERIA: StoreTemplate = {
  key: "papeleria",
  name: "Papelería y libros",
  description:
    "Sobria y ordenada: azul tinta sobre papel, títulos condensados, esquinas rectas, botones de contorno y listado compacto.",
  colors: {
    primary: "#1e3a8a",
    accent: "#b91c1c",
    background: "#fbfbf8",
    foreground: "#1f2430",
    muted: "#4b5563",
  },
  settings: {
    typography: { heading: "oswald", body: "work-sans" },
    shape: { radius: "sm", button_style: "outline", shadow: "none", density: "compact" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      image_ratio: "3:4",
      card_hover: "none",
      heading_case: "uppercase",
      heading_tracking: "wide",
      heading_weight: "semibold",
    },
    header: {
      logo_position: "left",
      announcement: {
        text: "Escribe aquí tu aviso de pedidos al mayoreo o de envíos",
        background: "#1f2430",
        foreground: "#ffffff",
      },
      nav_bar: { style: "text", align: "start", size: "sm", sticky: true },
    },
    element_colors: {
      footer: { background: "#1e3a8a", foreground: "#ffffff" },
    },
    product_page: { gallery: "thumbnails", show_related: true, sticky_buy_bar: false },
    listing: { columns_mobile: 2, show_brand: true },
  },
  home_sections: [
    heroBlock(
      1,
      "Todo para escribir, estudiar y crear",
      "Escribe aquí qué categorías tienes y si vendes al mayoreo.",
      { label: "Ver productos", link: "/productos" },
      "left",
    ),
    newest(2, "Lo más pedido"),
    categoryGrid(3, "Departamentos"),
    faqShipping(4),
    contact(5),
  ],
  categories: [
    { name: "Cuadernos", slug: "cuadernos" },
    { name: "Escritura", slug: "escritura" },
    { name: "Arte y manualidades", slug: "arte-y-manualidades" },
    { name: "Libros", slug: "libros" },
  ],
  products: [
    {
      title: "Cuaderno profesional 100 hojas",
      category: "cuadernos",
      description: "Pasta flexible. Reemplaza este texto con tu descripción.",
      options: [{ name: "Rayado", values: ["Raya", "Cuadro"] }],
      variants: ["Raya", "Cuadro"].map((rayado) => ({
        options: { Rayado: rayado },
        price: 4900,
      })),
    },
    {
      title: "Set de plumas 6 piezas",
      category: "escritura",
      description: "Tinta de colores surtidos. Reemplaza este texto con tu descripción.",
      variants: [{ price: 8900 }],
    },
    {
      title: "Marcadores de colores 12 piezas",
      category: "arte-y-manualidades",
      description: "Punta gruesa. Reemplaza este texto con tu descripción.",
      variants: [{ price: 11900 }],
    },
    {
      title: "Libro de bolsillo",
      category: "libros",
      description: "Edición de bolsillo. Reemplaza este texto con título, autor y editorial.",
      variants: [{ price: 17900 }],
    },
  ],
};

const REGALOS: StoreTemplate = {
  key: "regalos",
  name: "Regalos y flores",
  description:
    "Romántica y festiva: rosa profundo y crema, serifa suave, esquinas redondeadas y portada en color tenue.",
  colors: {
    primary: "#9d174d",
    accent: "#b45309",
    background: "#fff7f5",
    foreground: "#3b1d2a",
    muted: "#6b4a58",
  },
  settings: {
    typography: { heading: "lora", body: "manrope" },
    shape: { radius: "full", button_style: "solid", shadow: "soft", density: "spacious" },
    // Personalidad (tema v5, ADR-063).
    personality: {
      card_style: "raised",
      image_ratio: "4:5",
      card_hover: "lift",
      card_align: "center",
      heading_weight: "semibold",
      motion: "subtle",
    },
    header: {
      logo_position: "center",
      announcement: {
        text: "Escribe aquí tu horario de entrega para fechas especiales",
        background: "#9d174d",
        foreground: "#ffffff",
      },
      nav_bar: { style: "text", align: "center", size: "md", sticky: false },
    },
    element_colors: {
      hero: { background: "#fce7f3", foreground: "#500724" },
      footer: { background: "#3b1d2a", foreground: "#fde8ef" },
    },
    product_page: { gallery: "dots", show_related: true, sticky_buy_bar: true },
    listing: { columns_mobile: 2, show_brand: false },
  },
  home_sections: [
    spaced(
      heroBlock(
        1,
        "Detalles que se recuerdan",
        "Escribe aquí tus zonas de entrega y fechas especiales.",
        { label: "Elegir un regalo", link: "/productos" },
        "center",
      ),
      "spacious",
    ),
    newest(2, "Para regalar hoy", "carousel"),
    benefits(3, [
      { icon: "gift", title: "Tarjeta con tu mensaje" },
      { icon: "clock", title: "Entrega el día que elijas" },
      { icon: "card", title: "Paga como prefieras" },
    ]),
    categoryGrid(4, "Para cada ocasión"),
    reviews(5),
    contact(6),
  ],
  categories: [
    { name: "Ramos y arreglos", slug: "ramos-y-arreglos" },
    { name: "Cajas de regalo", slug: "cajas-de-regalo" },
    { name: "Globos y fiesta", slug: "globos-y-fiesta" },
    { name: "Tarjetas y detalles", slug: "tarjetas-y-detalles" },
  ],
  products: [
    {
      title: "Ramo de rosas",
      category: "ramos-y-arreglos",
      description: "Ramo envuelto en papel. Reemplaza este texto con tu descripción.",
      options: [{ name: "Tamaño", values: ["Mediano", "Grande"] }],
      variants: [
        { options: { Tamaño: "Mediano" }, price: 49900 },
        { options: { Tamaño: "Grande" }, price: 79900 },
      ],
    },
    {
      title: "Caja de regalo sorpresa",
      category: "cajas-de-regalo",
      description: "Caja con detalles surtidos. Reemplaza este texto con el contenido real.",
      variants: [{ price: 59900 }],
    },
    {
      title: "Set de globos para fiesta",
      category: "globos-y-fiesta",
      description: "Globos de colores surtidos. Reemplaza este texto con tu descripción.",
      variants: [{ price: 14900 }],
    },
    {
      title: "Tarjeta de felicitación",
      category: "tarjetas-y-detalles",
      description: "Tarjeta con sobre. Reemplaza este texto con tu descripción.",
      variants: [{ price: 4900 }],
    },
  ],
};

export const STORE_TEMPLATES: readonly StoreTemplate[] = [
  SUPLEMENTOS,
  ROPA,
  BELLEZA,
  ABARROTES,
  HOGAR,
  MASCOTAS,
  JOYERIA,
  ELECTRONICA,
  GOURMET,
  JUGUETES,
  PAPELERIA,
  REGALOS,
  GENERICA,
  BLANCO,
];

export function findTemplate(key: string): StoreTemplate | undefined {
  return STORE_TEMPLATES.find((t) => t.key === key);
}

/** Lo que recibe `store_apply_template` (sin nombre ni descripción). */
/**
 * Claves de diseño que una plantilla define por completo. Las que no trae van
 * como null (la base las quita): así no se queda la personalidad, los colores por
 * elemento ni el encabezado de la plantilla anterior (revisión 2026-11-06). El
 * contenido de la tienda (pie, redes, SEO, contacto y favicon) no se toca.
 */
export const TEMPLATE_DESIGN_KEYS = [
  "colors",
  "typography",
  "shape",
  "header",
  "element_colors",
  "product_page",
  "listing",
  "personality",
] as const satisfies readonly (keyof ThemeSettings)[];

export type TemplateSettingsPatch = {
  [K in keyof ThemeSettings]?: ThemeSettings[K] | null;
};

export function templatePayload(t: StoreTemplate) {
  const reset = Object.fromEntries(
    TEMPLATE_DESIGN_KEYS.map((key) => [key, null]),
  ) as TemplateSettingsPatch;
  const settings: TemplateSettingsPatch = { ...reset, ...t.settings, colors: t.colors };
  return {
    key: t.key,
    settings,
    home_sections: t.home_sections,
    categories: t.categories,
    products: t.products,
  };
}

/** Aviso tras aplicar una plantilla; sin ejemplos no los menciona («En blanco»). */
export function templateAppliedMessage(name: string, products: number): string {
  const samples =
    products === 0
      ? ""
      : ` con ${products === 1 ? "1 producto de ejemplo" : `${products} productos de ejemplo`}`;
  return `Plantilla «${name}» aplicada al borrador${samples}. Revísala en la vista previa.`;
}
