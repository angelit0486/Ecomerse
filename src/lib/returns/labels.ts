/**
 * Devoluciones (ADR-061): textos de motivos y estados. Las claves son las de la
 * base (`return_requests.reason` y `status`); cambiar una exige migración.
 */
export const RETURN_REASONS = [
  "damaged",
  "wrong_item",
  "not_as_described",
  "no_longer_needed",
  "other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_REASON_LABEL: Record<string, string> = {
  damaged: "Llegó dañado",
  wrong_item: "No es lo que pedí",
  not_as_described: "No es como se describía",
  no_longer_needed: "Ya no lo necesito",
  other: "Otro motivo",
};

/** Estado, como lo ve la tienda. */
export const RETURN_STATUS_LABEL: Record<string, string> = {
  requested: "Por revisar",
  approved: "Aprobada: esperando el paquete",
  received: "Recibida",
  closed: "Cerrada",
  rejected: "Rechazada",
};

/** Estado, como lo ve el cliente en la página de su pedido. */
export const RETURN_STATUS_FOR_CUSTOMER: Record<string, string> = {
  requested: "La tienda está revisando tu solicitud.",
  approved: "Tu devolución fue aprobada.",
  received: "La tienda recibió tu devolución.",
  closed: "Tu devolución está cerrada.",
  rejected: "La tienda no aprobó tu devolución.",
};
