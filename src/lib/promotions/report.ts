import { z } from "zod";

/**
 * Reporte de promociones (ADR-070, fase 4): contrato de `public.promotions_report`.
 * Todo el cálculo vive en la base (copia guardada en cada pedido pagado).
 */
const cents = z.number().int();
const count = z.number().int().min(0);

export const promotionsReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  rows: z.array(
    z.object({
      promotion_id: z.string().nullable(),
      name: z.string().nullable(),
      label: z.string().nullable(),
      type: z.string().nullable(),
      status: z.string().nullable(),
      orders: count,
      units: count,
      discount: cents,
      sales: cents,
    }),
  ),
  totals: z.object({ orders: count, discount: cents, sales: cents, paid_orders: count }),
});
export type PromotionsReport = z.infer<typeof promotionsReportSchema>;

export const REPORT_RANGES: Record<string, { days: number; label: string }> = {
  "7": { days: 7, label: "7 días" },
  "30": { days: 30, label: "30 días" },
  "90": { days: 90, label: "90 días" },
  "365": { days: 365, label: "12 meses" },
};

/** «3 de 10 pedidos pagados (30 %) usaron una promoción»; null sin pedidos. */
export function reachLabel(t: PromotionsReport["totals"]): string | null {
  if (t.paid_orders === 0) return null;
  const pct = Math.round((t.orders * 100) / t.paid_orders);
  return `${t.orders} de ${t.paid_orders} ${t.paid_orders === 1 ? "pedido pagado" : "pedidos pagados"} (${pct} %) ${
    t.orders === 1 ? "usó" : "usaron"
  } una promoción.`;
}

/** Ahorro como porcentaje de lo que se habría cobrado sin la promoción («20 %»). */
export function discountShare(row: { discount: number; sales: number }): string | null {
  const gross = row.sales + row.discount;
  if (gross <= 0 || row.discount <= 0) return null;
  return `${((row.discount * 100) / gross).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
}
