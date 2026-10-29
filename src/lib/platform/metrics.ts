import { z } from "zod";

/**
 * Consola → Métricas (misión vendible F4). Lo calcula `public.platform_metrics`:
 * solo conteos y sumas en centavos, sin datos de clientes. El MRR no se calcula
 * porque los planes aún no tienen precio (ADR-044, propuesto).
 */
export const METRIC_WINDOWS = [7, 30, 90, 365] as const;
export type MetricWindow = (typeof METRIC_WINDOWS)[number];

const count = z.number().int().nonnegative();
const cents = z.number().int();

export const metricsSchema = z.object({
  days: z.number().int(),
  organizations: z.object({ total: count, active: count, new: count }),
  subscriptions: z.record(z.string(), count),
  trials_ending_7d: count,
  plans: z.array(z.object({ key: z.string(), name: z.string(), organizations: count })),
  stores: z.object({ total: count, live: count, draft: count, with_sales: count }),
  sales: z.array(z.object({ currency: z.string(), orders: count, net: cents, refunded: cents })),
  top_stores: z.array(
    z.object({
      store: z.string(),
      handle: z.string(),
      currency: z.string(),
      orders: count,
      net: cents,
    }),
  ),
});
export type Metrics = z.infer<typeof metricsSchema>;

/** `?dias=` de la URL; cualquier otro valor vuelve a 30. */
export function parseWindow(value: string | undefined): MetricWindow {
  const n = Number(value);
  return METRIC_WINDOWS.find((w) => w === n) ?? 30;
}

export const SUBSCRIPTION_LABELS: Record<string, string> = {
  trialing: "En prueba",
  active: "Activas",
  past_due: "Pago vencido",
  paused: "Pausadas (solo lectura)",
};

/** Suscripciones en el orden en que importan para el negocio; estados desconocidos al final. */
export function subscriptionRows(subs: Metrics["subscriptions"]): [string, number][] {
  const order = Object.keys(SUBSCRIPTION_LABELS);
  return Object.entries(subs)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([status, n]) => [SUBSCRIPTION_LABELS[status] ?? status, n]);
}
