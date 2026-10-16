/**
 * Fecha estimada de entrega para la confirmación del pedido (revisión de
 * conversión, B4): «Llega entre el 18 y el 21 de octubre». Sale de los días de la
 * tarifa elegida (`est_days_min`/`est_days_max`, días naturales) contados desde
 * que se hizo el pedido, en el calendario de la tienda. Sin datos, null: nunca
 * se inventa una fecha.
 */
export function deliveryEstimate(input: {
  placedAt: string;
  minDays: number | null | undefined;
  maxDays: number | null | undefined;
  timeZone: string | undefined;
  locale?: string;
  /** Con `now`, si el último día del rango ya pasó no se muestra nada. */
  now?: Date;
}): string | null {
  const { minDays, maxDays } = input;
  if (minDays == null || maxDays == null) return null;
  if (!Number.isSafeInteger(minDays) || !Number.isSafeInteger(maxDays)) return null;
  if (minDays < 0 || maxDays < minDays || maxDays > 365) return null;
  const placed = Date.parse(input.placedAt);
  if (!Number.isFinite(placed)) return null;

  let timeZone = input.timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("es", { timeZone }).format(0);
  } catch {
    timeZone = "UTC";
  }
  const locale = input.locale ?? "es-MX";
  // Día calendario del pedido en la zona de la tienda; luego se suman días enteros.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(placed);
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const day = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset, 12));
  const from = day(minDays);
  const to = day(maxDays);
  if (input.now) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input.now);
    const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
    if (to.getTime() < Date.UTC(ty, tm - 1, td, 12)) return null;
  }
  const dayNum = (date: Date) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(date);
  const dayMonth = (date: Date) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
      date,
    );

  if (minDays === maxDays) return `Llega el ${dayMonth(to)}`;
  const sameMonth =
    from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear();
  return sameMonth
    ? `Llega entre el ${dayNum(from)} y el ${dayMonth(to)}`
    : `Llega entre el ${dayMonth(from)} y el ${dayMonth(to)}`;
}
