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

// -----------------------------------------------------------------------------
// Ficha del pedido (interruptor `order_whatsapp_handoff`): el comprador manda su
// pedido completo a la tienda con un toque al confirmarlo.
// -----------------------------------------------------------------------------

/** Máximo de renglones de productos: el enlace `wa.me` tiene un largo práctico. */
const TICKET_MAX_ITEMS = 25;

export interface OrderTicketData {
  storeName: string;
  displayNumber: string;
  /** Fecha y hora ya formateadas en la zona de la tienda. */
  placedAt: string;
  items: { quantity: number; title: string; variant: string | null; lineTotal: string }[];
  subtotal: string;
  discount: { code: string | null; amount: string } | null;
  /** Monto ya formateado o «Gratis»; `name` es la tarifa elegida. */
  shipping: { name: string | null; amount: string } | null;
  tax: { label: string; amount: string } | null;
  total: string;
  delivery:
    | {
        kind: "address";
        recipient: string;
        line1: string;
        line2?: string | undefined;
        postalCode: string;
        city: string;
        region: string;
        /** Código ISO de dos letras («MX»). */
        country: string;
      }
    | { kind: "pickup"; address: string | null }
    | null;
  contact: { name: string; phone: string | null; email: string | null };
  payment: { name: string; manual: boolean; paid: boolean } | null;
}

/** Un dato capturado en un solo renglón: sin saltos ni espacios dobles. */
function one(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Nombre de la tienda con letras normales (las decorativas de Unicode, como 𝓐, se normalizan). */
function plainStoreName(name: string): string {
  const shown = name
    .normalize("NFKC")
    .replace(/[\s|·•\-–—/]+$/u, "")
    .trim();
  return shown || name.trim();
}

/** «+52 662 123 4567» o «+1 650 300 8656»; cualquier otro número, tal cual. */
export function prettyPhone(phone: string): string {
  const p = phone.trim();
  const mx = /^\+52(\d{3})(\d{3})(\d{4})$/.exec(p);
  if (mx) return `+52 ${mx[1]} ${mx[2]} ${mx[3]}`;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  if (us) return `+1 ${us[1]} ${us[2]} ${us[3]}`;
  return p;
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["es-MX"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/**
 * Del comprador a la tienda: la ficha completa del pedido. Usa el formato de
 * WhatsApp (*negritas*) para que se lea como una ficha y no como un párrafo.
 */
export function orderTicketMessage(d: OrderTicketData): string {
  const lines: string[] = [
    `*Pedido ${one(d.displayNumber)} · ${one(plainStoreName(d.storeName))}*`,
    `Fecha: ${one(d.placedAt)}`,
    "",
    "Hola, acabo de hacer este pedido en su tienda en línea.",
    "",
    "*Productos*",
  ];
  for (const item of d.items.slice(0, TICKET_MAX_ITEMS)) {
    const variant = one(item.variant);
    lines.push(
      `• ${item.quantity} × ${one(item.title)}${variant ? ` (${variant})` : ""}: ${one(item.lineTotal)}`,
    );
  }
  const rest = d.items.length - TICKET_MAX_ITEMS;
  if (rest > 0) lines.push(`• y ${rest} ${rest === 1 ? "producto" : "productos"} más`);

  lines.push("", `Subtotal: ${d.subtotal}`);
  if (d.discount) {
    const code = one(d.discount.code);
    lines.push(`Descuento${code ? ` (${code})` : ""}: −${d.discount.amount}`);
  }
  if (d.shipping) {
    const name = one(d.shipping.name);
    lines.push(`Envío${name ? ` (${name})` : ""}: ${d.shipping.amount}`);
  }
  if (d.tax) lines.push(`${d.tax.label}: ${d.tax.amount}`);
  lines.push(`*Total: ${d.total}*`);

  if (d.delivery?.kind === "address") {
    const a = d.delivery;
    const street = [one(a.line1), one(a.line2)].filter(Boolean).join(", ");
    lines.push(
      "",
      "*Entrega a domicilio*",
      one(a.recipient),
      street,
      `C.P. ${one(a.postalCode)}, ${one(a.city)}, ${one(a.region)}, ${countryName(one(a.country))}`,
    );
  } else if (d.delivery?.kind === "pickup") {
    lines.push("", "*Entrega:* recoger en tienda");
    if (one(d.delivery.address)) lines.push(one(d.delivery.address));
  }

  lines.push("", "*Contacto*", one(d.contact.name));
  if (one(d.contact.phone)) lines.push(`Cel. ${prettyPhone(one(d.contact.phone))}`);
  if (one(d.contact.email)) lines.push(one(d.contact.email));

  if (d.payment) {
    lines.push("", `*Pago:* ${one(d.payment.name)}${d.payment.paid ? " (pagado)" : ""}`);
    if (d.payment.manual && !d.payment.paid) {
      lines.push("En cuanto pague, les envío mi comprobante por este chat.");
    }
  }
  return lines.join("\n");
}
