import { addDays, daysBetween, isIsoDay, zonedDayStart } from "@/lib/time/zoned-day";

export interface PaidRange {
  from: string;
  to: string;
  /** Instantes UTC [start, end) de ese rango de días en la zona de la tienda. */
  start: string;
  end: string;
}

/**
 * Filtro de la lista de pedidos por fecha de pago (`?desde=AAAA-MM-DD&hasta=…`),
 * días de calendario en la zona de la tienda: el mismo rango que cuenta
 * `dashboard_kpis` (paid_at ∈ [desde 00:00, hasta+1 00:00)). Inicio enlaza aquí
 * desde «Pedidos pagados». Un rango inválido se ignora (lista sin filtro).
 */
export function parsePaidRange(
  sp: Record<string, string | string[] | undefined>,
  timeZone: string,
): PaidRange | null {
  const from = sp.desde;
  const to = sp.hasta;
  if (!isIsoDay(from) || !isIsoDay(to)) return null;
  const span = daysBetween(from, to);
  // Mismo tope que dashboard_kpis (DB-L4): hasta 366 días.
  if (span < 0 || span > 365) return null;
  return {
    from,
    to,
    start: zonedDayStart(from, timeZone).toISOString(),
    end: zonedDayStart(addDays(to, 1), timeZone).toISOString(),
  };
}
