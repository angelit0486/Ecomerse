import { supplementFieldLabel } from "@/lib/compliance/labels";

/**
 * Textos del catálogo compartidos por acciones y componentes. Los códigos vienen
 * de la base (app.validate_product_for_publish y detalles de validation_failed).
 */
export const PUBLISH_ISSUES: Record<string, string> = {
  title_missing: "Falta el título.",
  no_active_variant: "Necesita al menos una variante activa.",
  price_zero: "Hay variantes activas con precio 0.",
  schedule_expired:
    "La tienda no podía publicar a la hora programada; se canceló la programación. Vuelve a programarlo.",
  compare_at_price_invalid: "El precio de comparación debe ser mayor que el precio.",
  product_type_not_supported: "Este tipo de producto aún no se puede vender.",
  image_alt_missing: "Hay imágenes sin texto alternativo (recomendado para accesibilidad y SEO).",
  // Cumplimiento (ADR-021): la tienda declaró una categoría regulada.
  compliance_classification_missing:
    "Indica en la ficha sanitaria si es un suplemento alimenticio o un producto no regulado.",
  compliance_profile_pending:
    "Las reglas sanitarias de esta categoría aún no están revisadas: no se puede publicar todavía.",
  compliance_store_legend_pending:
    "Falta aprobar la leyenda sanitaria de tu tienda (Ajustes → Cumplimiento).",
};

/** Texto de un aviso de publicación. Los de cumplimiento traen el campo o la regla tras ":". */
export function publishIssueMessage(code: string): string {
  const [base, detail = ""] = code.split(":", 2);
  if (base === "compliance_field_missing") {
    return `Falta en la ficha sanitaria: ${supplementFieldLabel(detail).toLowerCase()}.`;
  }
  if (base === "compliance_forbidden_term") {
    return "El producto incluye un término que las reglas sanitarias no permiten. Revisa el título, la descripción, la ficha y los atributos.";
  }
  return Object.hasOwn(PUBLISH_ISSUES, code) ? PUBLISH_ISSUES[code]! : code;
}

/**
 * Avisos de la revisión del catálogo (super prompt §16): recomendaciones, no
 * bloqueos. Los códigos de publicación se traducen con publishIssueMessage.
 */
export const QUALITY_ISSUES: Record<string, { short: string; message: string }> = {
  brand_missing: { short: "Sin marca", message: "No tiene marca." },
  category_missing: { short: "Sin categoría", message: "No está en ninguna categoría." },
  image_missing: { short: "Sin imagen", message: "No tiene imágenes." },
  description_missing: { short: "Sin descripción", message: "No tiene descripción." },
  variant_sku_missing: { short: "Variantes sin SKU", message: "Hay variantes activas sin SKU." },
  variant_barcode_missing: {
    short: "Variantes sin código de barras",
    message: "Hay variantes activas sin código de barras.",
  },
  variant_weight_missing: {
    short: "Variantes sin peso",
    message: "Hay variantes que se envían sin peso: las tarifas por peso no las calculan.",
  },
};

export function qualityIssueMessage(code: string): string {
  return Object.hasOwn(QUALITY_ISSUES, code)
    ? QUALITY_ISSUES[code]!.message
    : publishIssueMessage(code);
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
  compare_at_price: "El «precio antes» debe ser mayor que el precio.",
  publish_at: "Elige una fecha y hora en el futuro y dentro de un año.",
  sale_price:
    "El precio de oferta debe ser mayor que 0 y menor que el precio regular de cada presentación.",
  percent: "Revisa el porcentaje.",
  starts_at: "El inicio no puede estar en el pasado ni a más de un año.",
  ends_at: "El fin debe ser después del inicio y como máximo 90 días después.",
  overlap:
    "Alguna presentación ya tiene una oferta en esas fechas. Cancélala o elige otras fechas.",
  sale: "Esa oferta ya no existe.",
  status: "Solo se programa un borrador: este producto ya está publicado o archivado.",
  prices: "Revisa los precios: números enteros de centavos o con dos decimales.",
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
  draft: "Pausado (borrador)",
  active: "Publicado",
  archived: "Archivado",
};
