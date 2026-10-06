import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import { PermanentJobError } from "@/server/jobs/types";
import type { StripeProvider } from "@/server/payments/stripe";

/**
 * Job refund.execute (GATE0 §18.6): ejecuta la solicitud con el proveedor y aplica
 * el resultado. `manual` (transferencia, efectivo) y `fake` no tienen pasarela: el
 * reembolso se registra como hecho por la tienda. Stripe: refund con la clave de
 * idempotencia = id del reembolso; un reembolso aún pendiente se reintenta.
 */
interface RefundData {
  id: string;
  status: string;
  amount: number;
  provider: "manual" | "fake" | "stripe";
  provider_payment_id: string | null;
  account: {
    id: string;
    provider: "manual" | "fake" | "stripe";
    mode: "test" | "live";
    public_config: Record<string, unknown>;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createRefundHandlers(deps: {
  db: Sql;
  stripe?: () => StripeProvider | null;
}): Array<[string, JobHandler]> {
  const execute: JobHandler = async (job, { log }) => {
    const refundId = job.payload.refund_id;
    if (typeof refundId !== "string" || !UUID_RE.test(refundId))
      throw new PermanentJobError("payload.refund_id inválido");
    const [row] = await deps.db<
      { r: RefundData | null }[]
    >`select system.refund_for_execution(${refundId}) as r`;
    const refund = row?.r;
    if (!refund || refund.status !== "pending") return;

    let status: "succeeded" | "failed" | "pending";
    let reference: string | null = null;
    let failure: string | null = null;
    if (refund.provider === "manual" || refund.provider === "fake") {
      status = "succeeded";
      reference = `${refund.provider}_${refund.id}`;
    } else {
      const stripe = deps.stripe?.();
      if (!stripe) throw new Error("stripe_not_configured"); // reintento con backoff
      if (!refund.provider_payment_id) {
        status = "failed";
        failure = "missing_payment_reference";
      } else {
        const r = await stripe.refund({
          account: {
            id: refund.account.id,
            provider: "stripe",
            mode: refund.account.mode,
            publicConfig: refund.account.public_config,
          },
          providerPaymentId: refund.provider_payment_id,
          amount: Number(refund.amount),
          idempotencyKey: refund.id,
        });
        status = r.status;
        reference = r.providerRefundId;
        if (r.status === "failed") failure = "provider_failed";
      }
    }
    if (status === "pending") throw new Error("refund_pending"); // se re-consulta con la misma clave
    await deps.db`select system.apply_refund_result(${refund.id}, ${status}, ${reference}, ${failure})`;
    log.info("Reembolso aplicado", { refund_id: refund.id, status });
  };
  return [["refund.execute", execute]];
}
