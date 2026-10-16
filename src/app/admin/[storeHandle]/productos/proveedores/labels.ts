/** Textos de proveedores (ADR-025). */
export const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Disponible",
  limited: "Pocas piezas",
  unavailable: "No disponible",
  unknown: "Sin confirmar",
};

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
};

const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

/** «2 a 4 días», «3 días», «Hasta 5 días», «Desde 1 día» o null. */
export function leadTimeLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? days(min) : `${min} a ${days(max)}`;
  if (max !== null) return `Hasta ${days(max)}`;
  if (min !== null) return `Desde ${days(min)}`;
  return null;
}
