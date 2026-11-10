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

/** Avisos sobre qué tan completo es el número, del más importante al menos. */
export function profitNotes(r: ProfitReport): string[] {
  const notes: string[] = [];
  if (r.units_without_cost > 0) {
    notes.push(
      r.units_without_cost === 1
        ? "1 unidad vendida no tiene costo capturado: su venta no entra en la utilidad. Captura el costo en el producto."
        : `${r.units_without_cost} unidades vendidas no tienen costo capturado: su venta no entra en la utilidad. Captura el costo en cada producto.`,
    );
  }
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
