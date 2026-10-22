import type { HomeSectionType } from "@/lib/theme/schema";

/** Nombre de cada tipo de bloque de la portada (panel; lo usan Diseño y Colores). */
export const SECTION_LABELS: Record<HomeSectionType, string> = {
  hero: "Portada principal",
  featured_products: "Productos destacados",
  category_grid: "Categorías",
  promo_banner: "Banner de promoción",
  image_with_text: "Imagen con texto",
  brand_logos: "Marcas",
  testimonials: "Testimonios (escritos por ti)",
  rich_text: "Texto con formato",
  faq: "Preguntas frecuentes",
  benefits: "Beneficios y confianza",
  goals: "Compra por objetivo",
  reviews: "Opiniones verificadas",
  video: "Video",
  contact_map: "Contacto y ubicación",
};
