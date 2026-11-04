/**
 * Cada cuánto, como mucho, una instancia encola el mantenimiento periódico al
 * procesar la cola tras una acción (vencer pedidos, conciliar pagos, purgas).
 * `system.enqueue_maintenance()` ya es idempotente por minuto, hora o día; esto
 * solo evita una consulta extra en cada acción.
 */
export const MAINTENANCE_EVERY_MS = 60_000;

export function maintenanceThrottle(everyMs = MAINTENANCE_EVERY_MS) {
  let last = Number.NEGATIVE_INFINITY;
  return (now: number): boolean => {
    if (now - last < everyMs) return false;
    last = now;
    return true;
  };
}
