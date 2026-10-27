import type { OrderAxes } from "./visible-status";

export interface ProgressStep {
  label: string;
  done: boolean;
  current: boolean;
}

/**
 * Pasos de «qué sigue» para el comprador (página de gracias, auditoría UX):
 * se derivan de los tres ejes del pedido, igual que visibleStatus. Cancelados,
 * reembolsados o en revisión no muestran pasos (su estado ya lo dice).
 */
export function orderProgress(o: OrderAxes): ProgressStep[] | null {
  if (o.needs_attention || o.status === "cancelled") return null;
  if (o.payment_status === "refunded" || o.payment_status === "partially_refunded") return null;
  const paid = o.status !== "pending_payment" && o.payment_status === "paid";
  const shipped =
    o.status === "completed" ||
    ["partially_fulfilled", "fulfilled", "returned", "partially_returned"].includes(
      o.fulfillment_status,
    );
  const flags: [string, boolean][] = [
    ["Pedido recibido", true],
    ["Pago confirmado", paid],
    ["Enviado", paid && shipped],
    ["Entregado", o.status === "completed"],
  ];
  const firstPending = flags.findIndex(([, done]) => !done);
  return flags.map(([label, done], i) => ({ label, done, current: i === firstPending }));
}
