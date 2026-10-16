/**
 * Estados del despacho de un proveedor (ADR-025 paso 2). Mismas reglas que el
 * trigger `app.supplier_orders_guard`: se avanza (se pueden saltar pasos), se
 * marca con problema o cancelado desde cualquiera no final; un despacho con
 * problema vuelve a pendiente o se cancela. Entregado y cancelado son finales.
 */
export const SUPPLIER_ORDER_STATUSES = [
  "pending",
  "requested",
  "confirmed",
  "shipped",
  "delivered",
  "failed",
  "cancelled",
] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

const FORWARD: SupplierOrderStatus[] = [
  "pending",
  "requested",
  "confirmed",
  "shipped",
  "delivered",
];

export const SUPPLIER_ORDER_LABELS: Record<SupplierOrderStatus, string> = {
  pending: "Por pedir al proveedor",
  requested: "Solicitado al proveedor",
  confirmed: "Confirmado por el proveedor",
  shipped: "Enviado por el proveedor",
  delivered: "Entregado",
  failed: "Con problema",
  cancelled: "Cancelado",
};

/** Texto del botón que lleva a cada estado. */
export const SUPPLIER_ORDER_ACTIONS: Record<SupplierOrderStatus, string> = {
  pending: "Volver a pendiente",
  requested: "Ya lo pedí al proveedor",
  confirmed: "El proveedor lo confirmó",
  shipped: "El proveedor lo envió",
  delivered: "Entregado al cliente",
  failed: "Marcar con problema",
  cancelled: "Cancelar despacho",
};

export function isSupplierOrderStatus(value: unknown): value is SupplierOrderStatus {
  return (
    typeof value === "string" && (SUPPLIER_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isFinalSupplierOrderStatus(status: SupplierOrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

/** Estados a los que se puede pasar desde `from` (sin repetir el actual). */
export function nextSupplierOrderStatuses(from: SupplierOrderStatus): SupplierOrderStatus[] {
  if (isFinalSupplierOrderStatus(from)) return [];
  if (from === "failed") return ["pending", "cancelled"];
  const rank = FORWARD.indexOf(from);
  return [...FORWARD.slice(rank + 1), "failed", "cancelled"];
}
