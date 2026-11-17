/**
 * «Hoy» ("AAAA-MM-DD") en la zona horaria de la tienda. El servidor corre en
 * UTC: a las 20:00 de Hermosillo ya es mañana en UTC, y contar días por UTC
 * movería la ventana de ventas un día. Equivale a `(now() at time zone tz)::date`
 * de PostgreSQL (`dashboard_kpis`). Va aparte de `zoned-day.ts` para no
 * modificar ese archivo (lo comparte la rama de Inicio).
 */
export function zonedToday(timeZone: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
