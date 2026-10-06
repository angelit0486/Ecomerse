/** Textos del inventario compartidos por páginas y componentes. */
export const MOVEMENT_LABELS: Record<string, string> = {
  initial: "Inventario inicial",
  purchase: "Compra recibida",
  sale: "Venta enviada",
  return: "Devolución",
  adjustment: "Ajuste",
  damage: "Daño",
  loss: "Pérdida",
  transfer_in: "Transferencia (entrada)",
  transfer_out: "Transferencia (salida)",
  reservation: "Reserva",
  release: "Liberación de reserva",
};

/** "Color=Negro|Talla=M" → "Negro / M". */
export function variantLabel(signature: string): string {
  return signature
    .split("|")
    .filter(Boolean)
    .map((pair) => pair.slice(pair.indexOf("=") + 1))
    .join(" / ");
}
