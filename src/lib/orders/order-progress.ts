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
 * Con `pickup` (pedido de «Recoger en tienda») los dos últimos pasos dicen
 * «Listo para recoger» y «Recogido».
 */
export function orderProgress(
  o: OrderAxes,
  options: { pickup?: boolean } = {},
): ProgressStep[] | null {
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
    // «Recoger en tienda»: no hay envío; el pedido queda listo y el cliente lo recoge.
    [options.pickup ? "Listo para recoger" : "Enviado", paid && shipped],
    [options.pickup ? "Recogido" : "Entregado", o.status === "completed"],
  ];
  const firstPending = flags.findIndex(([, done]) => !done);
  return flags.map(([label, done], i) => ({ label, done, current: i === firstPending }));
}
