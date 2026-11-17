/**
 * Avisos de pedido por WhatsApp con un toque (D-INT-03). No hay API: se arma un
 * enlace `wa.me` con el mensaje ya escrito y la persona solo toca «Enviar».
 * Solo funciones puras: los datos del pedido los lee el servidor con sus permisos.
 */

/** Prefijo internacional por país de la tienda, para celulares escritos sin «+». */
const COUNTRY_CODE: Record<string, string> = { MX: "52" };

/**
 * Número para `wa.me` (solo dígitos, con código de país) o null si no se puede
 * saber a quién escribir. Acepta «+52 55 1234 5678», «55-1234-5678» (con la
 * tienda en México) y «044 55…»/«045 55…» antiguos.
 */
export function whatsappNumber(phone: string | null | undefined, country: string): string | null {
  if (!phone) return null;
  const raw = phone.trim();
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  const code = COUNTRY_CODE[country.toUpperCase()];
  if (!code) return null;
  if (code === "52") {
    if (/^04[45]\d{10}$/.test(digits)) digits = digits.slice(3);
    if (/^52\d{10}$/.test(digits)) return digits;
    if (/^521\d{10}$/.test(digits)) return `52${digits.slice(3)}`;
    return /^\d{10}$/.test(digits) ? `52${digits}` : null;
  }
  return null;
}

/** Enlace que abre el chat con ese número y el mensaje escrito. */
export function whatsappChatUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export interface OrderMessageData {
  storeName: string;
  customerName: string;
  displayNumber: string;
  /** Total ya formateado («$1,250.00»). */
  total: string;
}

function hello(d: OrderMessageData): string {
  const first = d.customerName.trim().split(/\s+/)[0];
  return first ? `Hola, ${first}.` : "Hola.";
}

/** Del comprador a la tienda: manda su comprobante de pago. */
export function proofMessage(d: OrderMessageData): string {
  return `Hola, ${d.storeName.trim()}. Les envío el comprobante de pago de mi pedido ${d.displayNumber} por ${d.total}.`;
}

/** De la tienda al cliente: recibimos tu pedido (con las instrucciones si espera el pago). */
export function orderReceivedMessage(
  d: OrderMessageData & { instructions?: string | null },
): string {
  const lines = [
    `${hello(d)} Recibimos tu pedido ${d.displayNumber} en ${d.storeName.trim()} por ${d.total}.`,
  ];
  if (d.instructions?.trim()) {
    lines.push(
      "",
      "Para pagar:",
      d.instructions.trim(),
      "",
      "Cuando pagues, mándanos tu comprobante por aquí.",
    );
  }
  return lines.join("\n");
}

/** De la tienda al cliente: confirmamos tu pago. */
export function paymentConfirmedMessage(d: OrderMessageData): string {
  return `${hello(d)} Confirmamos tu pago de ${d.total} del pedido ${d.displayNumber}. Te avisamos por aquí cuando salga. ¡Gracias por tu compra en ${d.storeName.trim()}!`;
}

/** De la tienda al cliente: tu pedido va en camino, con la guía. */
export function shippedMessage(
  d: OrderMessageData & {
    carrier?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
  },
): string {
  const lines = [`${hello(d)} Tu pedido ${d.displayNumber} ya va en camino.`];
  if (d.carrier?.trim()) lines.push(`Paquetería: ${d.carrier.trim()}`);
  if (d.trackingNumber?.trim()) lines.push(`Guía: ${d.trackingNumber.trim()}`);
  if (d.trackingUrl?.trim()) lines.push(`Rastréalo aquí: ${d.trackingUrl.trim()}`);
  lines.push(`Gracias por tu compra en ${d.storeName.trim()}.`);
  return lines.join("\n");
}

/** De la tienda al cliente: tu pedido está listo para recoger. */
export function readyForPickupMessage(d: OrderMessageData & { pickup?: string | null }): string {
  const lines = [
    `${hello(d)} Tu pedido ${d.displayNumber} está listo para recoger en ${d.storeName.trim()}.`,
  ];
  if (d.pickup?.trim()) lines.push(d.pickup.trim());
  return lines.join("\n");
}
