/**
 * Plazo de preparación de una variante que solo tiene existencias de proveedor
 * (ADR-025 §5): el que capturó la tienda para ese proveedor, nunca inventado.
 * Sin plazo o con 0 días no se dice nada. Nunca nombra al proveedor.
 */
export function leadTimeLabel(
  days: { min: number; max: number } | null | undefined,
): string | null {
  if (!days) return null;
  const { min, max } = days;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) return null;
  if (min < 0 || max < min || max > 365 || max === 0) return null;
  const range = min === max ? `${max} ${max === 1 ? "día" : "días"}` : `${min} a ${max} días`;
  return `Se prepara en ${range} antes de enviarse`;
}
