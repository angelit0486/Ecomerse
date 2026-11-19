/**
 * Primera visita a la página del pedido, justo después de confirmarlo
 * (interruptor `order_whatsapp_handoff`): solo entonces se abre WhatsApp solo.
 * La página quita la marca de la dirección al cargar, así que volver o recargar
 * no lo abre otra vez. A una pasarela de pago externa no se le agrega nada.
 */
export const JUST_PLACED_PARAM = "nuevo";

export function justPlacedTarget(target: string): string {
  if (!target.startsWith("/pedido/")) return target;
  return `${target}${target.includes("?") ? "&" : "?"}${JUST_PLACED_PARAM}=1`;
}
