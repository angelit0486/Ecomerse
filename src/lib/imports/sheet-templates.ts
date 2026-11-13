/**
 * Hojas de inicio por giro (Orden 09): los títulos de columna, en español, que
 * conviene llenar según lo que vende el comercio. Solo encabezados: nunca
 * productos de ejemplo. Todas las columnas las entiende la «hoja simple»
 * (`translatePlatformCsv`), así que el archivo se sube tal cual.
 */
export interface SheetTemplate {
  key: string;
  label: string;
  /** Para qué comercios sirve, en una frase. */
  hint: string;
  headers: readonly string[];
}

// «Publicado» (sí/no) pide publicar el producto al importar (Orden 10, mensaje 4):
// se publica después, solo si cumple las reglas de publicación; si no, queda en
// borrador con su motivo. Vacía, no cambia nada.
const COMMON_END = ["Marca", "Categoría", "Descripción", "Fotos", "Publicado"] as const;

export const SHEET_TEMPLATES: readonly SheetTemplate[] = [
  {
    key: "ropa",
    label: "Ropa, calzado y accesorios",
    hint: "Una fila por cada talla y color del mismo producto.",
    headers: [
      "Producto",
      "Talla",
      "Color",
      "Precio",
      "Precio anterior",
      "Existencias",
      "SKU",
      "Código de barras",
      ...COMMON_END,
    ],
  },
  {
    key: "hogar",
    label: "Hogar, belleza y regalos",
    hint: "Una fila por producto; usa Presentación si se vende en varios tamaños.",
    headers: [
      "Producto",
      "Presentación",
      "Precio",
      "Precio anterior",
      "Existencias",
      "SKU",
      "Código de barras",
      "Peso (g)",
      ...COMMON_END,
    ],
  },
  {
    key: "abarrotes",
    label: "Abarrotes",
    hint: "Una fila por presentación (1 kg, 5 kg), con su código de barras y su costo.",
    headers: [
      "Producto",
      "Presentación",
      "Precio",
      "Costo",
      "Existencias",
      "SKU",
      "Código de barras",
      ...COMMON_END,
    ],
  },
  {
    key: "suplementos",
    label: "Suplementos",
    hint: "Una fila por sabor y tamaño. La ficha sanitaria se llena después en cada producto.",
    headers: [
      "Producto",
      "Sabor",
      "Tamaño",
      "Precio",
      "Precio anterior",
      "Costo",
      "Existencias",
      "SKU",
      "Código de barras",
      ...COMMON_END,
    ],
  },
];

export function sheetTemplate(key: string | null | undefined): SheetTemplate | undefined {
  return SHEET_TEMPLATES.find((t) => t.key === key);
}
