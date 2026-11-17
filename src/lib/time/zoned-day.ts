/**
 * Fechas de calendario ("AAAA-MM-DD") en la zona horaria de la tienda.
 * El servidor corre en UTC; los rangos del panel (Inicio, lista de pedidos)
 * se cuentan en la zona de la tienda, igual que `public.dashboard_kpis`.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha de calendario válida ("2026-02-30" no lo es)? */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Fecha "AAAA-MM-DD" desplazada `n` días (n negativo = hacia atrás). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días entre dos fechas de calendario (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Desfase (ms) de la zona respecto de UTC en el instante dado. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - (instant - (instant % 1000));
}

/**
 * Instante UTC de las 00:00 del día `iso` en `timeZone` (equivale a
 * `iso::timestamp at time zone tz` de PostgreSQL). Dos pasadas para cruzar
 * correctamente un cambio de horario.
 */
export function zonedDayStart(iso: string, timeZone: string): Date {
  const naive = Date.parse(`${iso}T00:00:00Z`);
  let guess = naive - offsetMs(naive, timeZone);
  guess = naive - offsetMs(guess, timeZone);
  return new Date(guess);
}
