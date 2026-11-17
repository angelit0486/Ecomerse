import { z } from "zod";

/**
 * Reporte de rentabilidad (interruptor `profit_report`). Los números los calcula
 * `public.profit_report()` en centavos; aquí solo se validan y se describen.
 */
const cents = z.number().int();

export const profitReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  orders: z.number().int(),
  cancelled_orders: z.number().int(),
  revenue: cents,
  revenue_without_cost: cents,
  cost: cents,
  other_refunds: cents,
  profit: cents,
  units_without_cost: z.number().int(),
  units_current_cost: z.number().int(),
  shipping_charged: cents,
  tax: cents,
  products: z.array(
    z.object({
      product_id: z.string().nullable(),
      title: z.string(),
      units: z.number().int(),
      revenue: cents,
      cost: cents.nullable(),
      profit: cents.nullable(),
    }),
  ),
  order_rows: z.array(
    z.object({
      order_id: z.string(),
      number: z.string(),
      paid_at: z.string(),
      revenue: cents,
      cost: cents,
      other_refunds: cents,
      profit: cents.nullable(),
    }),
  ),
});
export type ProfitReport = z.infer<typeof profitReportSchema>;

export const PROFIT_RANGES: Record<string, { days: number; label: string }> = {
  "7": { days: 7, label: "7 días" },
  "30": { days: 30, label: "30 días" },
  "90": { days: 90, label: "90 días" },
};

/** Día ISO `n` días antes (fechas de calendario, sin zona horaria). */
export function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Margen en porcentaje con un decimal («43.5 %»); sin venta no hay margen. */
export function marginLabel(profit: number | null, revenue: number): string {
  if (profit === null || revenue <= 0) return "—";
  // Décimas de punto con enteros: sin sorpresas de coma flotante.
  const tenths = Math.round((profit * 1000) / revenue);
  const sign = tenths < 0 ? "−" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.trunc(abs / 10)}.${abs % 10} %`;
}

/** Venta que sí entra en la utilidad (la que tiene costo capturado). */
export function revenueWithCost(r: ProfitReport): number {
  return r.revenue - r.revenue_without_cost;
}

export interface ProfitCoverage {
  /**
   * none: hay venta sin costo y ninguna con costo (la utilidad no se puede calcular).
   * partial: la utilidad cubre solo parte de la venta. full: toda la venta tiene costo.
   */
  state: "none" | "partial" | "full";
  /** Venta con costo ÷ venta total, en entero 0–100 redondeado hacia abajo. */
  coveredPct: number;
}

/**
 * Qué parte de la venta entra en la utilidad. `profit_report()` solo resta el
 * costo de la venta que lo tiene (`revenue_without_cost` queda fuera), así que
 * sin costos la utilidad sale $0 o negativa por reembolsos: no es un resultado.
 * Se decide por venta, no por unidades: unidades sin costo y sin venta (regalos
 * al 100 %) no cambian la utilidad calculada y se siguen avisando en las notas.
 */
export function profitCoverage(r: ProfitReport): ProfitCoverage {
  if (r.revenue_without_cost <= 0) return { state: "full", coveredPct: 100 };
  const withCost = revenueWithCost(r);
  if (withCost <= 0) return { state: "none", coveredPct: 0 };
  // revenue > revenue_without_cost > 0: sin división entre cero; enteros, sin flotantes.
  return { state: "partial", coveredPct: Math.floor((withCost * 100) / r.revenue) };
}

/** «62 %»; si lo cubierto no llega al 1 %, no se dice «0 %». */
export function coveredPctLabel(pct: number): string {
  return pct < 1 ? "menos del 1 %" : `${pct} %`;
}

/**
 * Columna Costo de «Por pedido». La base deja `profit` en null cuando alguna
 * unidad conservada del pedido no tiene costo, y `cost` suma solo las que sí:
 * con 0 no hay costo capturado; con más de 0, es parcial. Límite: un pedido que
 * mezcla unidades sin costo con otras de costo capturado en $0 se ve «Sin costo».
 */
export function orderCostLabel(row: { cost: number; profit: number | null }): string | null {
  if (row.profit !== null) return null;
  return row.cost === 0 ? "Sin costo" : "Incompleto";
}

/** Aviso de unidades vendidas sin costo capturado (null si no hay). */
export function missingCostNote(r: ProfitReport): string | null {
  if (r.units_without_cost <= 0) return null;
  return r.units_without_cost === 1
    ? "1 unidad vendida no tiene costo capturado: su venta no entra en la utilidad. Captura el costo en el producto."
    : `${r.units_without_cost} unidades vendidas no tienen costo capturado: su venta no entra en la utilidad. Captura el costo en cada producto.`;
}

/**
 * Avisos sobre qué tan completo es el número, del más importante al menos.
 * Con `includeMissingCost: false` se omite el de unidades sin costo (la página
 * lo muestra destacado arriba de las tarjetas).
 */
export function profitNotes(
  r: ProfitReport,
  { includeMissingCost = true }: { includeMissingCost?: boolean } = {},
): string[] {
  const notes: string[] = [];
  const missing = missingCostNote(r);
  if (includeMissingCost && missing) notes.push(missing);
  if (r.units_current_cost > 0) {
    notes.push(
      r.units_current_cost === 1
        ? "1 unidad se vendió antes de que guardáramos el costo de cada venta: usa el costo de hoy."
        : `${r.units_current_cost} unidades se vendieron antes de que guardáramos el costo de cada venta: usan el costo de hoy.`,
    );
  }
  if (r.cancelled_orders > 0) {
    notes.push(
      r.cancelled_orders === 1
        ? "1 pedido cancelado no se cuenta."
        : `${r.cancelled_orders} pedidos cancelados no se cuentan.`,
    );
  }
  notes.push(
    "Todavía no se descuentan las comisiones de tu medio de pago ni lo que te cuesta el envío.",
  );
  return notes;
}
