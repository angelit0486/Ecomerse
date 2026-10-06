import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import type { StripeProvider } from "@/server/payments/stripe";
import { reconcilePayments } from "@/server/payments/webhook";

/**
 * Jobs del ciclo de pedidos (GATE0 §17.5-17.6).
 * - `orders.expire`: cada minuto (system.enqueue_maintenance) cancela los pedidos
 *   sin pagar con la reserva vencida y libera existencias y cupones.
 * - `order.created` / `order.paid`: los emails al comprador y a la tienda llegan
 *   con las notificaciones de la F7; hasta entonces el job solo deja constancia
 *   (sin PII) para no acabar como `unknown_job_type`.
 */
export function createOrderHandlers(deps: {
  db: Sql;
  onExpired?: (count: number) => void;
  /** Stripe configurado; sin él la reconciliación no tiene nada que consultar. */
  stripe?: () => StripeProvider | null;
}): Array<[string, JobHandler]> {
  const expire: JobHandler = async (_job, { log }) => {
    const [row] = await deps.db<{ n: number }[]>`select system.expire_orders(200) as n`;
    const count = row?.n ?? 0;
    if (count > 0) log.info("Pedidos vencidos", { count });
    deps.onExpired?.(count);
  };
  const record =
    (event: string): JobHandler =>
    async (job, { log }) => {
      log.info("Evento de pedido", {
        event,
        order_id: job.payload.order_id,
        store_id: job.storeId,
      });
    };
  const purgeRateLimits: JobHandler = async (_job, { log }) => {
    const [row] = await deps.db<{ n: number }[]>`select system.purge_rate_limits() as n`;
    log.info("Ventanas de rate limit purgadas", { count: row?.n ?? 0 });
  };
  const complete: JobHandler = async (_job, { log }) => {
    const [row] = await deps.db<{ n: number }[]>`select system.complete_orders() as n`;
    if ((row?.n ?? 0) > 0) log.info("Pedidos completados", { count: row?.n });
  };
  const reconcile: JobHandler = async (_job, { log }) => {
    const stripe = deps.stripe?.();
    if (!stripe) return;
    const count = await reconcilePayments({ db: deps.db, provider: stripe, log });
    if (count > 0) log.info("Pagos reconciliados", { count });
  };
  return [
    ["orders.expire", expire],
    ["payments.reconcile", reconcile],
    ["payment.failed", record("payment.failed")],
    ["payment.late_without_stock", record("payment.late_without_stock")],
    ["orders.complete", complete],
    ["order.shipped", record("order.shipped")],
    ["order.cancelled", record("order.cancelled")],
    ["refund.succeeded", record("refund.succeeded")],
    ["rate_limits.purge", purgeRateLimits],
    ["order.created", record("order.created")],
    ["order.paid", record("order.paid")],
  ];
}
