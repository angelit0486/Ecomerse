/**
 * Estado visible del pedido (GATE0 §16.4): una etiqueta a partir de los tres ejes.
 * Función pura; la usan el pedido del invitado y el panel.
 */
export interface OrderAxes {
  status: string;
  payment_status: string;
  fulfillment_status: string;
  needs_attention?: boolean;
}

export type VisibleStatus =
  | "Pendiente de pago"
  | "Pagado — por preparar"
  | "Enviado parcialmente"
  | "Enviado"
  | "Entregado"
  | "Completado"
  | "Cancelado"
  | "Reembolsado"
  | "Reembolsado parcialmente"
  | "Requiere atención";

export function visibleStatus(o: OrderAxes): VisibleStatus {
  if (o.needs_attention) return "Requiere atención";
  if (o.payment_status === "refunded") return "Reembolsado";
  if (o.status === "cancelled") return "Cancelado";
  if (o.payment_status === "partially_refunded") return "Reembolsado parcialmente";
  if (o.status === "completed") return "Completado";
  if (o.status === "pending_payment") return "Pendiente de pago";
  if (o.fulfillment_status === "partially_fulfilled") return "Enviado parcialmente";
  if (o.fulfillment_status === "fulfilled") return "Enviado";
  if (o.fulfillment_status === "returned" || o.fulfillment_status === "partially_returned")
    return "Entregado";
  return "Pagado — por preparar";
}
