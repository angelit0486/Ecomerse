import { addDays, daysBetween } from "@/lib/time/zoned-day";

/**
 * Inicio como centro de control (Orden 1): lógica pura de las tarjetas.
 * Nada aquí consulta la base; la página carga los datos (acotados por tienda y
 * con RLS / guardas en la base) y estas funciones deciden qué decir y a dónde
 * llevar.
 */

// ---------------------------------------------------------------- Estados

/**
 * Estado de una tarjeta. `error` nunca se pinta como cero: la tarjeta dice que
 * no se pudo cargar (regla de "sin ceros engañosos").
 */
export type CardState<T> =
  { status: "ok"; data: T } | { status: "error" } | { status: "forbidden" } | { status: "off" };

export const cardOk = <T>(data: T): CardState<T> => ({ status: "ok", data });
export const CARD_ERROR = { status: "error" } as const;
export const CARD_FORBIDDEN = { status: "forbidden" } as const;
export const CARD_OFF = { status: "off" } as const;

// ---------------------------------------------------------------- Periodo anterior

export interface Period {
  from: string;
  to: string;
}

/**
 * Los mismos N días inmediatamente antes de `[from, to]` (ambos incluidos).
 * Las fechas son de calendario en la zona de la tienda (las que devuelve
 * `dashboard_kpis`), así que basta con restar días.
 */
export function previousPeriod({ from, to }: Period): Period {
  const days = daysBetween(from, to) + 1;
  if (!Number.isFinite(days) || days < 1) throw new Error("invalid_period");
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

// ---------------------------------------------------------------- Variaciones

export type Comparison =
  | { kind: "change"; delta: number; percent: number | null; direction: "up" | "down" | "flat" }
  | { kind: "no_previous" }
  | { kind: "both_zero" };

/**
 * Variación absoluta y porcentual contra el periodo anterior. Si el anterior es
 * 0 no hay porcentaje posible (nada de "+∞%"); si es negativo (más reembolsos
 * que ventas) el porcentaje no tiene sentido y solo se da la diferencia.
 */
export function compareValues(current: number, previous: number): Comparison {
  if (previous === 0) return current === 0 ? { kind: "both_zero" } : { kind: "no_previous" };
  const delta = current - previous;
  const percent = previous > 0 ? Math.round((delta / previous) * 1000) / 10 : null;
  return {
    kind: "change",
    delta,
    percent,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

const pct = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;

/**
 * Texto de la variación. `format` da formato a la diferencia (dinero o
 * conteo); `emptyPrevious` explica un periodo anterior en cero.
 */
export function describeComparison(
  c: Comparison,
  format: (n: number) => string,
  emptyPrevious: string,
): string {
  if (c.kind === "no_previous") return emptyPrevious;
  if (c.kind === "both_zero") return "Igual que el periodo anterior (en cero)";
  if (c.direction === "flat") return "Igual que el periodo anterior";
  const sign = c.delta > 0 ? "+" : "−";
  const abs = `${sign}${format(Math.abs(c.delta))}`;
  return c.percent === null
    ? `${abs} vs. periodo anterior`
    : `${abs} (${pct(c.percent)}) vs. periodo anterior`;
}

// ---------------------------------------------------------------- Antigüedad

/** "hace X minutos/horas/días" entre `since` y `now`. */
export function formatAge(since: string | Date, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(since).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "hace menos de un minuto";
  if (minutes < 60) return minutes === 1 ? "hace 1 minuto" : `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return `hace ${days.toLocaleString("es-MX")} días`;
}

/** Pendientes con más de un día de antigüedad merecen un borde de aviso. */
export function isStale(since: string | Date, now: Date = new Date(), hours = 24): boolean {
  return now.getTime() - new Date(since).getTime() >= hours * 3_600_000;
}

// ---------------------------------------------------------------- Enlaces

/** Filtros que la lista de pedidos ya soporta (`?estado=`). */
export type OrdersFilter = "por-surtir" | "atencion" | "pendientes" | "pagados" | "todos";

/**
 * Enlace a la lista de pedidos. Con `paid` filtra por fecha de pago en la zona
 * de la tienda (`desde`/`hasta`), el mismo criterio que cuenta `dashboard_kpis`.
 */
export function ordersHref(base: string, filter: OrdersFilter, paid?: Period): string {
  const params = new URLSearchParams({ estado: filter });
  if (paid) {
    params.set("desde", paid.from);
    params.set("hasta", paid.to);
  }
  return `${base}/pedidos?${params.toString()}`;
}

export const customersHref = (base: string) => `${base}/clientes`;
/** No hay lista de carritos en el panel: el enlace va al ajuste del recordatorio. */
export const cartRecoverySettingsHref = (base: string) => `${base}/ajustes/notificaciones`;

/** Variación de una métrica (net_sales, orders, average_ticket) lista para pintar. */
export interface MetricComparison {
  text: string;
  direction: "up" | "down" | "flat" | "none";
}

export function metricComparison(
  current: number,
  previous: number,
  format: (n: number) => string,
  emptyPrevious: string,
): MetricComparison {
  const c = compareValues(current, previous);
  return {
    text: describeComparison(c, format, emptyPrevious),
    direction: c.kind === "change" ? c.direction : "none",
  };
}
