/**
 * Productos por página en el listado del panel (misión vendible F3). Con 1000
 * productos, 25 por página obligaba a repetir una acción en bloque 40 veces; las
 * acciones en bloque aceptan hasta 100 a la vez.
 */
export const PRODUCT_PAGE_SIZES = [25, 50, 100] as const;
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];

/** Lee `?por=` de la URL; cualquier otro valor vuelve a 25. */
export function parsePageSize(value: string | undefined): ProductPageSize {
  const n = Number(value);
  return PRODUCT_PAGE_SIZES.find((s) => s === n) ?? 25;
}
