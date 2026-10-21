import type { HomeSection } from "@/lib/theme/schema";

/**
 * Plantillas de portada para el editor (misión Portada/Marcas, Paso 3). A
 * diferencia de las plantillas de tienda (ADR-034 §5) no crean productos ni
 * categorías: solo reemplazan los bloques del editor, que la dueña revisa y
 * guarda en el borrador. Usan las marcas con logo y los objetivos que la
 * tienda ya tiene; si no hay suficientes, ese bloque no se agrega.
 *
 * Los textos no prometen efectos (cumplimiento, Fase R) y se pueden cambiar.
 */
export const HOME_LAYOUTS = [
  {
    key: "anaquel",
    name: "Anaquel",
    description: "Como una tienda de suplementos: categorías, lo más vendido y marcas.",
  },
  {
    key: "deportivo",
    name: "Deportivo",
    description: "Foto grande de fondo, objetivos primero y carruseles.",
  },
  { key: "neutral", name: "Neutral", description: "Sencilla y clara, para cualquier giro." },
  { key: "blanco", name: "En blanco", description: "Solo la portada principal para empezar." },
] as const;

export type HomeLayoutKey = (typeof HOME_LAYOUTS)[number]["key"];

export interface HomeLayoutContext {
  storeName: string;
  /** Marcas con logo, en el orden del panel. */
  brandIds: string[];
  /** Valores del atributo «Objetivo». */
  goalIds: string[];
}

const benefits = (n: () => string): HomeSection => ({
  id: n(),
  type: "benefits",
  enabled: true,
  props: {
    items: [
      { icon: "truck", title: "Envío a todo México" },
      { icon: "shield", title: "Productos originales" },
      { icon: "card", title: "Pago seguro" },
    ],
  },
});

const faq = (n: () => string): HomeSection => ({
  id: n(),
  type: "faq",
  enabled: true,
  props: {
    title: "Preguntas frecuentes",
    items: [
      {
        question: "¿Cuánto tarda mi envío?",
        answer: "Escribe aquí tus tiempos de entrega reales por zona.",
      },
      { question: "¿Cómo puedo pagar?", answer: "Escribe aquí los métodos de pago que aceptas." },
    ],
  },
});

const products = (
  n: () => string,
  title: string,
  type: "best_selling" | "newest",
  layout: "grid" | "carousel" = "grid",
): HomeSection => ({
  id: n(),
  type: "featured_products",
  enabled: true,
  props: { title, source: { type }, limit: 8, show_view_all: true, layout },
});

function optional(ctx: HomeLayoutContext, n: () => string) {
  return {
    brands: (): HomeSection[] =>
      ctx.brandIds.length >= 2
        ? [
            {
              id: n(),
              type: "brand_logos",
              enabled: true,
              props: { title: "Nuestras marcas", brand_ids: ctx.brandIds.slice(0, 12) },
            },
          ]
        : [],
    goals: (): HomeSection[] =>
      ctx.goalIds.length >= 1
        ? [
            {
              id: n(),
              type: "goals",
              enabled: true,
              props: { title: "Compra por objetivo", value_ids: ctx.goalIds.slice(0, 12) },
            },
          ]
        : [],
  };
}

/** Los bloques de una plantilla; `newId` da un id nuevo por bloque. */
export function buildHomeLayout(
  key: HomeLayoutKey,
  ctx: HomeLayoutContext,
  newId: () => string,
): HomeSection[] {
  const n = newId;
  const extra = optional(ctx, n);
  const name = ctx.storeName.trim().slice(0, 80) || "Bienvenido";
  switch (key) {
    case "anaquel":
      return [
        {
          id: n(),
          type: "hero",
          enabled: true,
          props: {
            heading: "Suplementos originales con envío a todo México",
            subheading: "Elige por categoría, marca u objetivo.",
            align: "left",
            cta: { label: "Ver productos", link: "/productos" },
          },
        },
        benefits(n),
        { id: n(), type: "category_grid", enabled: true, props: { title: "Compra por categoría" } },
        products(n, "Lo más vendido", "best_selling"),
        ...extra.goals(),
        products(n, "Lo más nuevo", "newest", "carousel"),
        ...extra.brands(),
        faq(n),
      ];
    case "deportivo":
      return [
        {
          id: n(),
          type: "hero",
          enabled: true,
          props: {
            heading: "Entrena con lo que necesitas",
            subheading: "Proteínas, creatinas y más, listos para enviarse.",
            align: "center",
            layout: "background",
            cta: { label: "Ver lo más vendido", link: "/productos" },
          },
        },
        ...extra.goals(),
        products(n, "Lo más vendido", "best_selling", "carousel"),
        {
          id: n(),
          type: "category_grid",
          enabled: true,
          props: { title: "Categorías", layout: "carousel" },
        },
        ...extra.brands(),
        benefits(n),
      ];
    case "neutral":
      return [
        {
          id: n(),
          type: "hero",
          enabled: true,
          props: {
            heading: name,
            subheading: "Conoce nuestros productos.",
            align: "center",
            cta: { label: "Ver productos", link: "/productos" },
          },
        },
        { id: n(), type: "category_grid", enabled: true, props: { title: "Categorías" } },
        products(n, "Novedades", "newest"),
        benefits(n),
        faq(n),
      ];
    case "blanco":
      return [
        {
          id: n(),
          type: "hero",
          enabled: true,
          props: { heading: name, align: "center" },
        },
      ];
  }
}
