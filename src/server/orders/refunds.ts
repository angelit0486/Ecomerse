import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import { PermanentJobError } from "@/server/jobs/types";
import type { Logger } from "@/server/observability/logger";
import type { MercadoPagoProvider } from "@/server/payments/mercadopago";
import { ProviderHttpError, type PaymentAccountCredentials } from "@/server/payments/provider";
import { StripeHttpError, stripeAccountId, type StripeProvider } from "@/server/payments/stripe";

/**
 * Job refund.execute (GATE0 §18.6): ejecuta la solicitud con el proveedor y aplica
 * el resultado. `manual` (transferencia, efectivo) y `fake` no tienen pasarela: el
 * reembolso se registra como hecho por la tienda.
 *
 * Stripe (Gate F7, APP-H1) y Mercado Pago (ADR-028): se crea con la clave de idempotencia = id del
 * reembolso; si queda pendiente se guarda el `re_…` y los reintentos lo CONSULTAN
 * (repetir el POST solo devolvería la primera respuesta). Un rechazo 4xx es
 * definitivo: reembolso fallido y pedido en atención. La reconciliación
 * (`payments.reconcile`) retoma los que siguen pendientes sin job activo.
 */
interface RefundData {
  id: string;
  status: string;
  amount: number;
  provider: "manual" | "fake" | "stripe" | "mercadopago";
  provider_payment_id: string | null;
  provider_refund_id: string | null;
  account: {
    id: string;
    provider: "manual" | "fake" | "stripe" | "mercadopago";
    mode: "test" | "live";
    public_config: Record<string, unknown>;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** La clave de idempotencia vale 24 h: después, crear de nuevo podría duplicar. */
const RECREATE_LIMIT_HOURS = 23;

type Outcome = "succeeded" | "failed" | "pending";

function credentials(account: RefundData["account"]): PaymentAccountCredentials {
  return {
    id: account.id,
    provider: account.provider,
    mode: account.mode,
    publicConfig: account.public_config,
  };
}

async function loadRefund(db: Sql, refundId: string): Promise<RefundData | null> {
  const [row] = await db<{ r: RefundData | null }[]>`
    select system.refund_for_execution(${refundId}) as r`;
  return row?.r ?? null;
}

/** Una pasada con el proveedor; devuelve el resultado ya aplicado (o `pending`). */
async function settle(
  deps: Providers & { db: Sql },
  refund: RefundData,
  options: { allowCreate: boolean },
): Promise<Outcome> {
  let status: Outcome;
  let reference: string | null = null;
  let failure: string | null = null;
  if (refund.provider === "manual" || refund.provider === "fake") {
    status = "succeeded";
    reference = `${refund.provider}_${refund.id}`;
  } else {
    const gateway = refund.provider === "mercadopago" ? deps.mercadopago?.() : deps.stripe?.();
    if (!gateway) throw new Error(`${refund.provider}_not_configured`); // reintento con backoff
    if (!refund.provider_payment_id) {
      status = "failed";
      failure = "missing_payment_reference";
    } else if (!refund.provider_refund_id && !options.allowCreate) {
      return "pending";
    } else {
      try {
        const r = await gateway.refund({
          account: credentials(refund.account),
          providerPaymentId: refund.provider_payment_id,
          amount: Number(refund.amount),
          idempotencyKey: refund.id,
          providerRefundId: refund.provider_refund_id,
        });
        status = r.status;
        reference = r.providerRefundId;
        if (r.status === "failed") failure = "provider_failed";
        if (r.status === "pending") {
          await deps.db`select system.record_refund_provider_ref(${refund.id}, ${r.providerRefundId})`;
        }
      } catch (error) {
        if (!(error instanceof ProviderHttpError) || !error.rejected) throw error; // red o 5xx: reintento
        status = "failed";
        failure = `provider_rejected_${error.httpStatus}`;
      }
    }
  }
  if (status !== "pending") {
    await deps.db`select system.apply_refund_result(${refund.id}, ${status}, ${reference}, ${failure})`;
  }
  return status;
}

interface Providers {
  stripe?: () => StripeProvider | null;
  mercadopago?: () => MercadoPagoProvider | null;
}

/** Reembolsos con pasarela pendientes sin job activo (cada 10 minutos). */
export async function reconcileRefunds(
  deps: Providers & { db: Sql; log: Logger },
): Promise<number> {
  if (!deps.stripe?.() && !deps.mercadopago?.()) return 0;
  const rows = await deps.db<
    { refund_id: string; provider_refund_id: string | null; age_hours: string }[]
  >`select * from system.refunds_to_reconcile(100)`;
  let settled = 0;
  for (const row of rows) {
    try {
      const refund = await loadRefund(deps.db, row.refund_id);
      if (!refund || refund.status !== "pending") continue;
      const recreate = Number(row.age_hours) < RECREATE_LIMIT_HOURS;
      if (!refund.provider_refund_id && !recreate) {
        await deps.db`select system.flag_refund_stuck(${refund.id})`;
        continue;
      }
      if ((await settle(deps, refund, { allowCreate: recreate })) !== "pending") settled += 1;
    } catch (error) {
      deps.log.warn("No se pudo reconciliar un reembolso", { refund_id: row.refund_id, error });
    }
  }
  return settled;
}

export function createRefundHandlers(deps: Providers & { db: Sql }): Array<[string, JobHandler]> {
  const execute: JobHandler = async (job, { log }) => {
    const refundId = job.payload.refund_id;
    if (typeof refundId !== "string" || !UUID_RE.test(refundId))
      throw new PermanentJobError("payload.refund_id inválido");
    const refund = await loadRefund(deps.db, refundId);
    if (!refund || refund.status !== "pending") return;
    const status = await settle(deps, refund, { allowCreate: true });
    if (status === "pending") throw new Error("refund_pending"); // reintento: consulta por re_…
    log.info("Reembolso aplicado", { refund_id: refund.id, status });
  };

  // Pedido cancelado: la sesión abierta en Stripe se expira para que ya no se pague.
  const expireCheckout: JobHandler = async (job, { log }) => {
    const paymentId = job.payload.payment_id;
    if (typeof paymentId !== "string" || !UUID_RE.test(paymentId))
      throw new PermanentJobError("payload.payment_id inválido");
    const [row] = await deps.db<
      { p: { checkout_id: string; account: RefundData["account"] } | null }[]
    >`select system.payment_for_expiry(${paymentId}) as p`;
    const payment = row?.p;
    const stripe = deps.stripe?.();
    if (!payment || !stripe) return;
    try {
      await stripe.api.expireSession(
        stripeAccountId(credentials(payment.account)),
        payment.checkout_id,
      );
    } catch (error) {
      // Ya pagada o vencida: no hay nada que cerrar (si se pagó, el webhook lo aplica).
      if (error instanceof StripeHttpError && error.rejected) {
        log.info("La sesión ya no estaba abierta", { payment_id: paymentId });
        return;
      }
      throw error;
    }
  };

  return [
    ["refund.execute", execute],
    ["payment.expire_checkout", expireCheckout],
  ];
}
