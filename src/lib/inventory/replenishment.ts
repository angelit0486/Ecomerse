/**
 * Reposición sugerida («Qué pedir»): cálculo puro, sin red ni base.
 *
 * - Demanda = unidades cobradas (pedidos con `paid_at` en la ventana, no
 *   cancelados, pagados o parcialmente reembolsados) menos lo reembolsado. No se
 *   usan movimientos `sale` de inventario: esos son envíos, no demanda cobrada.
 * - Ventana = los últimos `WINDOW_DAYS` días de calendario en la zona de la
 *   tienda, con el mismo criterio que `dashboard_kpis`:
 *   `paid_at ∈ [desde 00:00, hasta+1 00:00)`.
 * - El ritmo divide siempre entre `WINDOW_DAYS`, aunque la tienda sea más nueva:
 *   es conservador y la pantalla lo declara.
 * - Todo en enteros (unidades × días): sin errores de redondeo de punto flotante.
 */
import { addDays, zonedDayStart } from "@/lib/time/zoned-day";
import { zonedToday } from "@/lib/time/zoned-today";

/** Días de calendario de ventas que se consideran. */
export const WINDOW_DAYS = 30;
/** Margen que se suma al tiempo de entrega del proveedor. */
export const SAFETY_DAYS = 7;
/** Días a cubrir cuando no hay proveedor activo con plazo. */
export const DEFAULT_TARGET_DAYS = 30;
/** Tope del horizonte a cubrir (un plazo muy largo no debe pedir medio año). */
export const MAX_TARGET_DAYS = 90;
/** Estados de pago que cuentan como venta cobrada (ambos tienen `paid_at`). */
export const COUNTED_PAYMENT_STATUSES = ["paid", "partially_refunded"] as const;

export interface SalesWindow {
  /** Primer día incluido ("AAAA-MM-DD", zona de la tienda). */
  from: string;
  /** Último día incluido (hoy en la zona de la tienda). */
  to: string;
  /** Instante de las 00:00 de `from` (inclusivo). */
  start: Date;
  /** Instante de las 00:00 del día siguiente a `to` (exclusivo). */
  end: Date;
}

export function salesWindow(timeZone: string, now: Date = new Date()): SalesWindow {
  const to = zonedToday(timeZone, now);
  const from = addDays(to, -(WINDOW_DAYS - 1));
  return {
    from,
    to,
    start: zonedDayStart(from, timeZone),
    end: zonedDayStart(addDays(to, 1), timeZone),
  };
}

export interface StockItem {
  variantId: string;
  productId: string;
  productTitle: string;
  optionSignature: string;
  sku: string | null;
  trackInventory: boolean;
  available: number;
  lowStockThreshold: number | null;
}

export interface SaleLine {
  variantId: string | null;
  quantity: number;
  refundedQuantity: number;
  orderStatus: string;
  paymentStatus: string;
  paidAt: string | null;
}

export interface SupplierOption {
  id: string;
  name: string;
  status: string;
  leadTimeMinDays: number | null;
  leadTimeMaxDays: number | null;
}

export interface ChosenSupplier {
  id: string;
  name: string;
  /** Días de entrega considerados (máximo, o mínimo si solo hay mínimo); null si no hay plazo. */
  leadDays: number | null;
}

export interface ReplenishmentRow {
  variantId: string;
  productId: string;
  productTitle: string;
  optionSignature: string;
  sku: string | null;
  available: number;
  lowStockThreshold: number | null;
  /** En o por debajo del aviso (sin aviso: sin existencias). */
  lowStock: boolean;
  /** Unidades vendidas netas en la ventana; null si no se pudieron leer las ventas. */
  unitsSold: number | null;
  /** Días que alcanza lo disponible al ritmo actual; null si no hay ritmo (sin ventas o sin datos). */
  coverageDays: number | null;
  /** Días que se busca cubrir. */
  targetDays: number;
  /** Unidades a pedir; null si no hay ritmo para estimarlo (nunca un 0 inventado). */
  suggestedQuantity: number | null;
  supplier: ChosenSupplier | null;
}

/** Unidades netas cobradas por variante dentro de la ventana. */
export function unitsByVariant(
  lines: readonly SaleLine[],
  window: Pick<SalesWindow, "start" | "end">,
): Map<string, number> {
  const counted = new Set<string>(COUNTED_PAYMENT_STATUSES);
  const start = window.start.getTime();
  const end = window.end.getTime();
  const units = new Map<string, number>();
  for (const line of lines) {
    if (!line.variantId || !line.paidAt) continue;
    if (line.orderStatus === "cancelled" || !counted.has(line.paymentStatus)) continue;
    const paid = Date.parse(line.paidAt);
    if (!(paid >= start && paid < end)) continue;
    const net = line.quantity - line.refundedQuantity;
    if (!(net > 0)) continue;
    units.set(line.variantId, (units.get(line.variantId) ?? 0) + net);
  }
  return units;
}

const leadOf = (s: SupplierOption): number | null => s.leadTimeMaxDays ?? s.leadTimeMinDays ?? null;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Proveedor de referencia, determinista: entre los activos, el de menor plazo;
 * empate por nombre y luego id. Sin ninguno con plazo, el primer activo por
 * nombre (se muestra, pero el horizonte queda en el predeterminado).
 */
export function pickSupplier(options: readonly SupplierOption[]): ChosenSupplier | null {
  const active = options.filter((s) => s.status === "active");
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => {
    const la = leadOf(a);
    const lb = leadOf(b);
    if (la !== lb) {
      if (la === null) return 1;
      if (lb === null) return -1;
      return la - lb;
    }
    return byText(a.name, b.name) || byText(a.id, b.id);
  });
  const best = sorted[0]!;
  return { id: best.id, name: best.name, leadDays: leadOf(best) };
}

/** Días a cubrir: plazo + margen, o el predeterminado; nunca más del tope. */
export function targetDaysFor(leadDays: number | null): number {
  const days = leadDays === null ? DEFAULT_TARGET_DAYS : leadDays + SAFETY_DAYS;
  return Math.min(MAX_TARGET_DAYS, days);
}

/** ¿Está en o por debajo del aviso? Sin aviso, «bajo» es no tener disponible. */
export function isLowStock(available: number, threshold: number | null): boolean {
  return threshold === null ? available <= 0 : available <= threshold;
}

/** floor(available / ritmo) con ritmo = units / WINDOW_DAYS; nunca negativo. */
export function coverageDays(available: number, units: number): number | null {
  if (!(units > 0)) return null;
  return Math.max(0, Math.floor((available * WINDOW_DAYS) / units));
}

/** max(0, ceil(ritmo × target − available)); null sin ritmo. */
export function suggestedQuantity(available: number, units: number, target: number): number | null {
  if (!(units > 0)) return null;
  const needTimesWindow = units * target - available * WINDOW_DAYS;
  return Math.max(0, Math.ceil(needTimesWindow / WINDOW_DAYS));
}

export interface ReplenishmentInput {
  stock: readonly StockItem[];
  /** Unidades por variante; null si no hay permiso o datos de pedidos (solo regla de stock bajo). */
  sales: ReadonlyMap<string, number> | null;
  /** Proveedores por variante; vacío si no hay permiso de costos. */
  suppliersByVariant?: ReadonlyMap<string, readonly SupplierOption[]>;
}

/**
 * Variantes que conviene reponer, de la más urgente a la menos:
 * a) en o por debajo del aviso (sin aviso: disponible ≤ 0), o
 * b) con ventas y cobertura ≤ días objetivo.
 */
export function buildReplenishment(input: ReplenishmentInput): ReplenishmentRow[] {
  const rows: ReplenishmentRow[] = [];
  for (const item of input.stock) {
    if (!item.trackInventory) continue;
    const supplier = pickSupplier(input.suppliersByVariant?.get(item.variantId) ?? []);
    const target = targetDaysFor(supplier?.leadDays ?? null);
    const units = input.sales ? (input.sales.get(item.variantId) ?? 0) : null;
    const coverage = units === null ? null : coverageDays(item.available, units);
    const lowStock = isLowStock(item.available, item.lowStockThreshold);
    if (!lowStock && !(coverage !== null && coverage <= target)) continue;
    rows.push({
      variantId: item.variantId,
      productId: item.productId,
      productTitle: item.productTitle,
      optionSignature: item.optionSignature,
      sku: item.sku,
      available: item.available,
      lowStockThreshold: item.lowStockThreshold,
      lowStock,
      unitsSold: units,
      coverageDays: coverage,
      targetDays: target,
      suggestedQuantity: units === null ? null : suggestedQuantity(item.available, units, target),
      supplier,
    });
  }
  return rows.sort(compareUrgency);
}

/**
 * Agotadas primero (las que más se venden antes), luego por cobertura más
 * corta, luego las de stock bajo sin ritmo (menos disponible primero).
 * Desempate estable: título, SKU, id de variante.
 */
function compareUrgency(a: ReplenishmentRow, b: ReplenishmentRow): number {
  const group = (r: ReplenishmentRow) => (r.available <= 0 ? 0 : r.coverageDays !== null ? 1 : 2);
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0 && (a.unitsSold ?? 0) !== (b.unitsSold ?? 0)) {
    return (b.unitsSold ?? 0) - (a.unitsSold ?? 0);
  }
  if (ga === 1 && a.coverageDays !== b.coverageDays) return a.coverageDays! - b.coverageDays!;
  if (ga === 2 && a.available !== b.available) return a.available - b.available;
  return (
    byText(a.productTitle, b.productTitle) ||
    byText(a.sku ?? "", b.sku ?? "") ||
    byText(a.variantId, b.variantId)
  );
}
