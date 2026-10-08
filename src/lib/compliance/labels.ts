/**
 * Textos del módulo regulatorio (ADR-021) compartidos por el panel y la consola.
 * Las leyendas y los términos los escribe la plataforma con su asesor; aquí solo
 * van los nombres de los campos y de los estados.
 */
export const SUPPLEMENT_FIELD_LABELS: Record<string, string> = {
  form: "Presentación",
  serving_size: "Porción",
  servings_per_container: "Porciones por envase",
  ingredients: "Ingredientes",
  nutrition: "Información nutrimental",
  usage: "Modo de uso",
  warnings: "Advertencias",
  storage: "Conservación",
  allergens: "Alérgenos",
  sanitary_notice: "Aviso o registro sanitario",
};

export const PROFILE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente de revisión",
  active: "Revisadas",
  suspended: "Suspendidas",
};

export const RULE_KIND_LABELS: Record<string, string> = {
  required_field: "Campo obligatorio",
  required_legend: "Leyenda",
  forbidden_term: "Término prohibido",
};

export const PLACEMENT_LABELS: Record<string, string> = {
  product_page: "Ficha del producto",
  cart: "Carrito",
  checkout: "Checkout",
};

/** Etiqueta de un campo de la ficha (o la clave si no se conoce). */
export function supplementFieldLabel(key: string): string {
  return Object.hasOwn(SUPPLEMENT_FIELD_LABELS, key) ? SUPPLEMENT_FIELD_LABELS[key]! : key;
}
