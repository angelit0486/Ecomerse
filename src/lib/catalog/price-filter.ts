/**
 * Rango de precio y ofertas del listado (super prompt §7). En la URL van pesos
 * enteros (`precio_min`, `precio_max`) y `oferta=1`; la base filtra en centavos
 * sobre el precio desde del producto. Un valor inválido se ignora (nunca falla).
 */
export const MAX_PRICE_PESOS = 1_000_000;

export interface PriceFilter {
  /** Pesos enteros tal como se muestran en el formulario. */
  min?: number;
  max?: number;
  onSale: boolean;
}

type Params = Record<string, string | string[] | undefined>;

function pesos(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d{1,7}$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return n <= MAX_PRICE_PESOS ? n : undefined;
}

export function parsePriceFilter(params: Params): PriceFilter {
  let min = pesos(params.precio_min);
  let max = pesos(params.precio_max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    onSale: params.oferta === "1",
  };
}

/** Pares para la URL (mismo orden siempre: enlaces estables). */
export function priceFilterPairs(filter: PriceFilter): [string, string][] {
  return [
    ...(filter.min !== undefined ? [["precio_min", String(filter.min)] as [string, string]] : []),
    ...(filter.max !== undefined ? [["precio_max", String(filter.max)] as [string, string]] : []),
    ...(filter.onSale ? [["oferta", "1"] as [string, string]] : []),
  ];
}

/** Centavos para la consulta (el precio desde se guarda en centavos). */
export function priceFilterCents(filter: PriceFilter): { minPrice?: number; maxPrice?: number } {
  return {
    ...(filter.min !== undefined ? { minPrice: filter.min * 100 } : {}),
    // «Hasta $500» incluye $500.99: el tope cubre todo el último peso.
    ...(filter.max !== undefined ? { maxPrice: filter.max * 100 + 99 } : {}),
  };
}

/** Etiqueta del filtro activo («$200 a $500», «Desde $200», «Hasta $500»). */
export function priceFilterLabel(
  filter: PriceFilter,
  format: (pesos: number) => string,
): string | null {
  if (filter.min !== undefined && filter.max !== undefined) {
    return `${format(filter.min)} a ${format(filter.max)}`;
  }
  if (filter.min !== undefined) return `Desde ${format(filter.min)}`;
  if (filter.max !== undefined) return `Hasta ${format(filter.max)}`;
  return null;
}
