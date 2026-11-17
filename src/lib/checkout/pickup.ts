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
