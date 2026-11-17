/**
 * Cuánto tiempo siguen apartados los productos de un pedido esperando el pago,
 * en palabras para el comprador. Con transferencia el apartado dura 24 horas
 * (D-INT-02), así que «1440 minutos» se dice en horas.
 */
export function holdLeftLabel(minutes: number): string {
  if (minutes < 1) return "menos de un minuto";
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hora" : `${hours} horas`;
}
