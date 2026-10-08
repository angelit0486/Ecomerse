/**
 * Textos del catálogo compartidos por acciones y componentes. Los códigos vienen
 * de la base (app.validate_product_for_publish y detalles de validation_failed).
 */
export const PUBLISH_ISSUES: Record<string, string> = {
  title_missing: "Falta el título.",
  no_active_variant: "Necesita al menos una variante activa.",
  price_zero: "Hay variantes activas con precio 0.",
  compare_at_price_invalid: "El precio de comparación debe ser mayor que el precio.",
  product_type_not_supported: "Este tipo de producto aún no se puede vender.",
  image_alt_missing: "Hay imágenes sin texto alternativo (recomendado para accesibilidad y SEO).",
  // Cumplimiento (ADR-021): la tienda declaró una categoría regulada.
  compliance_classification_missing:
    "Indica en la ficha sanitaria si es un suplemento alimenticio o un producto no regulado.",
  compliance_profile_pending:
    "Las reglas sanitarias de esta categoría aún no están revisadas: no se puede publicar todavía.",
};

/** Campos de la ficha de suplementos, para los avisos de publicación. */
const REGULATORY_FIELDS: Record<string, string> = {
  form: "presentación",
  serving_size: "porción",
  servings_per_container: "porciones por envase",
  ingredients: "ingredientes",
  nutrition: "información nutrimental",
  usage: "modo de uso",
  warnings: "advertencias",
  storage: "conservación",
  allergens: "alérgenos",
  sanitary_notice: "aviso o registro sanitario",
};

/** Texto de un aviso de publicación. Los de cumplimiento traen el campo o la regla tras ":". */
export function publishIssueMessage(code: string): string {
  const [base, detail = ""] = code.split(":", 2);
  if (base === "compliance_field_missing") {
    const field = Object.hasOwn(REGULATORY_FIELDS, detail) ? REGULATORY_FIELDS[detail] : detail;
    return `Falta en la ficha sanitaria: ${field}.`;
  }
  if (base === "compliance_forbidden_term") {
    return "El producto incluye un término que las reglas sanitarias no permiten. Revisa el título, la descripción y la ficha.";
  }
  return Object.hasOwn(PUBLISH_ISSUES, code) ? PUBLISH_ISSUES[code]! : code;
}

export const FIELD_MESSAGES: Record<string, string> = {
  title: "Escribe un título de hasta 200 caracteres.",
  publish:
    "Este producto está publicado: necesita al menos una variante activa y precios mayores que 0. Corrígelo o despublícalo primero.",
  slug: "Esa dirección ya la usa otro producto o no es válida (solo minúsculas, números y guiones).",
  sku: "Ese SKU ya existe en la tienda.",
  barcode: "Ese código de barras ya existe en la tienda o no es válido.",
  variants: "Revisa las variantes: cada combinación debe ser única y tener precio.",
  options: "Revisa las opciones: máximo 3, con nombre y al menos un valor, sin repetir.",
  categories: "Elige categorías válidas y solo una principal.",
  brand_id: "Esa marca ya no existe.",
  description_html: "La descripción es demasiado larga.",
  seo_title: "Máximo 70 caracteres.",
  seo_description: "Máximo 320 caracteres.",
  tags: "Máximo 50 etiquetas de hasta 60 caracteres.",
  name: "Escribe un nombre de hasta 120 caracteres.",
  parent_id:
    "Esa categoría padre no es válida (no puede ser ella misma ni una subcategoría, y hay máximo 4 niveles).",
  file: "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB.",
  mime_type: "Usa una imagen JPG, PNG, WebP o AVIF.",
  bytes: "La imagen pesa demasiado (máximo 10 MB).",
  alt_text: "Máximo 250 caracteres.",
  media_ids: "El orden de las imágenes no es válido. Recarga la página.",
};

export const REJECTION_REASONS: Record<string, string> = {
  mime_mismatch: "El archivo no es del tipo que dice ser.",
  unsupported_format: "Formato no permitido. Usa JPG, PNG, WebP o AVIF.",
  too_large: "La imagen pesa demasiado.",
  too_many_pixels: "La imagen tiene demasiados píxeles (máximo 40 megapíxeles).",
  decode_failed: "No pudimos leer la imagen. ¿Está dañada?",
  missing_file: "La subida no terminó. Inténtalo de nuevo.",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  active: "Publicado",
  archived: "Archivado",
};
