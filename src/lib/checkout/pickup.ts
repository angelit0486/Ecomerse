/**
 * Dónde se recoge un pedido con la forma de envío «Recoger en tienda»: la
 * dirección y el horario que la tienda ya declaró en su contacto. Si no
 * declaró ninguno devuelve null (no se inventa nada).
 */
export function pickupInfo(
  contact: { address?: string | undefined; hours?: string | undefined } | null | undefined,
): { address: string | null; hours: string | null } | null {
  const address = contact?.address?.trim() || null;
  const hours = contact?.hours?.trim() || null;
  return address || hours ? { address, hours } : null;
}

/** Estados en los que el pedido aún está por recogerse (los mismos ejes de `visibleStatus`). */
const PICKUP_PENDING_STATUSES = ["pending_payment", "paid", "processing", "open"];

/**
 * Dónde y cuándo recoger un pedido ya hecho. Solo si la forma de envío copiada
 * al pedido (snapshot, no la tarifa de hoy) es «Recoger en tienda», el pedido
 * sigue por recogerse y la tienda declaró una dirección: sin dirección no hay
 * nada útil que decir, aunque haya horario.
 */
export function orderPickupInfo(
  order: {
    status: string;
    payment_status: string;
    shipping: { type?: string | undefined } | null;
  },
  contact: Parameters<typeof pickupInfo>[0],
): { address: string; hours: string | null } | null {
  if (order.shipping?.type !== "pickup") return null;
  if (!PICKUP_PENDING_STATUSES.includes(order.status) || order.payment_status === "refunded")
    return null;
  const info = pickupInfo(contact);
  return info?.address ? { address: info.address, hours: info.hours } : null;
}
