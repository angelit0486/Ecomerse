export const JOB_STATUS: Record<string, string> = {
  validating: "Validando",
  validated: "Validado, sin confirmar",
  committing: "Importando",
  completed: "Importado",
  failed: "Falló (no se cambió nada)",
  cancelled: "Cancelado",
  blocked: "Bloqueado",
};

export const MODE: Record<string, string> = {
  upsert: "Crear y actualizar",
  create_only: "Solo crear",
  update_existing: "Solo actualizar",
};

const PUBLISH_FAILURE = /^(Fila \d+: )?([Nn])o se puede publicar \(([a-z0-9_:,]+)\)$/;

/**
 * El error guardado por system.import_commit lleva los códigos de publicación
 * (§14.3 y cumplimiento, ADR-021) entre paréntesis: aquí se traducen.
 */
export function importErrorText(error: string, translate: (code: string) => string): string {
  const match = PUBLISH_FAILURE.exec(error);
  if (!match) return error;
  const issues = match[3]!.split(",").filter(Boolean).map(translate);
  return `${match[1] ?? ""}${match[2]}o se puede publicar. ${issues.join(" ")}`;
}

/** Nombre en español de cada columna de la plantilla (misión panel, F1). */
export const COLUMN_LABELS: Record<string, string> = {
  handle: "Nombre corto",
  title: "Nombre",
  status: "Estado",
  description: "Descripción",
  brand: "Marca",
  categories: "Categorías",
  tags: "Etiquetas",
  option1_name: "Opción 1",
  option1_value: "Valor de la opción 1",
  option2_name: "Opción 2",
  option2_value: "Valor de la opción 2",
  option3_name: "Opción 3",
  option3_value: "Valor de la opción 3",
  opciones: "Opciones",
  sku: "Código interno (SKU)",
  barcode: "Código de barras",
  price: "Precio",
  compare_at_price: "Precio antes",
  cost: "Costo",
  inventory_quantity: "Existencias",
  inventory_policy: "Vender sin existencias",
  requires_shipping: "Se envía",
  weight_g: "Peso (g)",
  length_mm: "Largo (mm)",
  width_mm: "Ancho (mm)",
  height_mm: "Alto (mm)",
  variant_status: "Estado de la presentación",
  seo_title: "Título para buscadores",
  seo_description: "Descripción para buscadores",
  variant_net_content: "Contenido neto de la presentación",
  variant_servings: "Porciones de la presentación",
  regulatory_category: "Tipo de producto regulado",
  attributes: "Atributos",
  image_urls: "Fotos (enlaces)",
};

/**
 * «price: escribe un importe…» → «Precio (columna price): escribe un importe…».
 * El nombre técnico se conserva para encontrar la columna en el archivo.
 */
export function friendlyRowError(error: string): string {
  const match = /^([a-z0-9_]+): (.*)$/s.exec(error);
  if (!match) return error;
  const [, column, rest] = match;
  const label =
    COLUMN_LABELS[column!] ?? (column!.startsWith("regulatory_") ? "Ficha sanitaria" : undefined);
  return label ? `${label} (columna ${column}): ${rest}` : error;
}
