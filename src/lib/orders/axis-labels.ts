/**
 * Etiquetas en español de los valores de los ejes del pedido (estado, pago y
 * envío) para el historial del panel: antes se mostraban los códigos internos
 * («pending_payment → open»). Un valor desconocido se muestra tal cual.
 */
const LABELS: Record<string, string> = {
  // Estado
  pending_payment: "Pendiente de pago",
  open: "Abierto",
  completed: "Completado",
  cancelled: "Cancelado",
  // Pago
  unpaid: "Sin pagar",
  pending: "Pago en proceso",
  authorized: "Autorizado",
  paid: "Pagado",
  partially_refunded: "Reembolsado parcialmente",
  refunded: "Reembolsado",
  failed: "Pago fallido",
  expired: "Pago vencido",
  voided: "Anulado",
  // Envío
  unfulfilled: "Por enviar",
  partially_fulfilled: "Enviado parcialmente",
  fulfilled: "Enviado",
  partially_returned: "Devuelto parcialmente",
  returned: "Devuelto",
};

export function axisValueLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value;
}

/** Proveedor y estado de un intento de pago, en español (panel del pedido). */
const PAYMENT_PROVIDERS: Record<string, string> = {
  manual: "Pago manual",
  fake: "Pago de prueba",
  stripe: "Tarjeta (Stripe)",
  mercadopago: "Mercado Pago",
};
const PAYMENT_ATTEMPT: Record<string, string> = {
  created: "Iniciado",
  pending: "En proceso",
  authorized: "Autorizado",
  succeeded: "Cobrado",
  failed: "Rechazado",
  cancelled: "Cancelado",
  expired: "Vencido",
};

export function paymentProviderLabel(value: string): string {
  return PAYMENT_PROVIDERS[value] ?? value;
}

export function paymentAttemptLabel(value: string): string {
  return PAYMENT_ATTEMPT[value] ?? value;
}
