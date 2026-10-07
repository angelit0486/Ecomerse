import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import type { StripeProvider } from "@/server/payments/stripe";
import { reconcilePayments } from "@/server/payments/webhook";

import { reconcileRefunds } from "./refunds";

/**
 * Jobs del ciclo de pedidos (GATE0 §17.5-17.6).
 * - `orders.expire`: cada minuto (system.enqueue_maintenance) cancela los pedidos
 *   sin pagar con la reserva vencida y libera existencias y cupones.
 * - Los eventos del pedido (`order.*`, `payment.failed`, `refund.succeeded`…) los
 *   atienden las notificaciones (src/server/notifications/order-handlers.ts).
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
    const refunds = await reconcileRefunds({ db: deps.db, stripe: deps.stripe, log });
    if (refunds > 0) log.info("Reembolsos reconciliados", { count: refunds });
  };
  return [
    ["orders.expire", expire],
    ["payments.reconcile", reconcile],
    ["orders.complete", complete],
    ["rate_limits.purge", purgeRateLimits],
  ];
}
