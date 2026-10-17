import { formatMoney } from "@/lib/money/format";

import { escapeHtml } from "./templates";
import type { EmailMessage } from "./types";

/**
 * Plantillas de pedidos con la marca de la tienda (GATE0 §27.2). Todo dato
 * variable se escapa; el color solo se usa si es un hex de 6 dígitos y el logo
 * solo si es una URL https del almacenamiento público de medios.
 */
export interface OrderEmailData {
  store: {
    name: string;
    locale: string;
    currency: string;
    contact_email: string | null;
    logoUrl: string | null;
    primary_color: string | null;
  };
  order: {
    display_number: string;
    customer_name: string;
    subtotal: number;
    discount_total: number;
    shipping_total: number;
    tax_total: number;
    total: number;
    prices_include_tax: boolean;
    shipping_name: string | null;
  };
  items: { title: string; variant: string | null; quantity: number; line_total: number }[];
  orderUrl: string | null;
  payment?: { display_name: string; instructions: string | null } | null;
  shipment?: {
    carrier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
  } | null;
  refund?: { amount: number } | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function money(cents: number, d: OrderEmailData): string {
  return formatMoney(cents, d.store.currency, d.store.locale);
}

function button(label: string, href: string, color: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function layout(d: OrderEmailData, title: string, body: string): string {
  const header =
    d.store.logoUrl && d.store.logoUrl.startsWith("https://")
      ? `<img src="${escapeHtml(d.store.logoUrl)}" alt="${escapeHtml(d.store.name)}" height="48" style="max-height:48px">`
      : `<strong style="font-size:20px">${escapeHtml(d.store.name)}</strong>`;
  const contact = d.store.contact_email
    ? `<p style="color:#555;font-size:13px">¿Dudas? Responde a este correo o escribe a ${escapeHtml(d.store.contact_email)}.</p>`
    : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px"><div style="margin-bottom:24px">${header}</div>${body}${contact}</body></html>`;
}

function itemsHtml(d: OrderEmailData): string {
  const rows = d.items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0">${i.quantity} × ${escapeHtml(i.title)}${i.variant ? ` (${escapeHtml(i.variant)})` : ""}</td><td style="text-align:right">${escapeHtml(money(i.line_total, d))}</td></tr>`,
    )
    .join("");
  const line = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0${strong ? ";font-weight:600" : ""}">${escapeHtml(label)}</td><td style="text-align:right${strong ? ";font-weight:600" : ""}">${escapeHtml(value)}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}${line("Subtotal", money(d.order.subtotal, d))}${
    d.order.discount_total > 0 ? line("Descuento", `−${money(d.order.discount_total, d)}`) : ""
  }${line(`Envío${d.order.shipping_name ? ` (${d.order.shipping_name})` : ""}`, money(d.order.shipping_total, d))}${
    d.order.tax_total > 0
      ? line(
          d.order.prices_include_tax ? "Impuestos incluidos" : "Impuestos",
          money(d.order.tax_total, d),
        )
      : ""
  }${line("Total", money(d.order.total, d), true)}</table>`;
}

function itemsText(d: OrderEmailData): string {
  return [
    ...d.items.map(
      (i) =>
        `${i.quantity} × ${i.title}${i.variant ? ` (${i.variant})` : ""}: ${money(i.line_total, d)}`,
    ),
    `Total: ${money(d.order.total, d)}`,
  ].join("\n");
}

function message(
  d: OrderEmailData,
  to: string,
  subject: string,
  html: string,
  text: string[],
): EmailMessage {
  return {
    to,
    subject,
    html: layout(d, subject, html),
    text: [...text, "", d.store.name].join("\n"),
    fromName: d.store.name,
    ...(d.store.contact_email ? { replyTo: d.store.contact_email } : {}),
  };
}

const color = (d: OrderEmailData) =>
  d.store.primary_color && HEX.test(d.store.primary_color) ? d.store.primary_color : "#1a1a1a";

/** Pedido recibido con pago diferido (manual): instrucciones de pago. */
export function orderReceivedEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `Recibimos tu pedido ${d.order.display_number}`;
  const instructions = d.payment?.instructions ?? "";
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Recibimos tu pedido <strong>${escapeHtml(d.order.display_number)}</strong>. Queda pendiente de pago${
      d.payment ? ` (${escapeHtml(d.payment.display_name)})` : ""
    }.</p>${instructions ? `<p style="white-space:pre-line;background:#f5f5f5;padding:12px;border-radius:6px">${escapeHtml(instructions)}</p>` : ""}${itemsHtml(d)}${
      d.orderUrl ? button("Ver mi pedido", d.orderUrl, color(d)) : ""
    }`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Recibimos tu pedido ${d.order.display_number}. Queda pendiente de pago.`,
      instructions,
      "",
      itemsText(d),
      d.orderUrl ? `Tu pedido: ${d.orderUrl}` : "",
    ],
  );
}

export function orderConfirmationEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `Confirmamos tu pedido ${d.order.display_number}`;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Recibimos tu pago. Estamos preparando tu pedido <strong>${escapeHtml(d.order.display_number)}</strong>.</p>${itemsHtml(d)}${
      d.orderUrl ? button("Ver mi pedido", d.orderUrl, color(d)) : ""
    }`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Recibimos tu pago. Estamos preparando tu pedido ${d.order.display_number}.`,
      "",
      itemsText(d),
      d.orderUrl ? `Tu pedido: ${d.orderUrl}` : "",
    ],
  );
}

export function paymentFailedEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `No pudimos cobrar tu pedido ${d.order.display_number}`;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>El pago de tu pedido <strong>${escapeHtml(d.order.display_number)}</strong> no se completó. Tus productos siguen apartados por un tiempo: puedes reintentar el pago desde tu pedido.</p>${
      d.orderUrl ? button("Reintentar el pago", d.orderUrl, color(d)) : ""
    }`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `El pago de tu pedido ${d.order.display_number} no se completó. Puedes reintentarlo desde tu pedido.`,
      d.orderUrl ?? "",
    ],
  );
}

export function orderShippedEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `Tu pedido ${d.order.display_number} va en camino`;
  const s = d.shipment;
  // La base ya exige https; aquí se vuelve a comprobar (nunca un esquema javascript:).
  const trackingUrl = s?.tracking_url?.startsWith("https://") ? s.tracking_url : null;
  const tracking = s?.tracking_number
    ? `${s.carrier ? `${s.carrier}: ` : ""}${s.tracking_number}`
    : null;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Enviamos tu pedido <strong>${escapeHtml(d.order.display_number)}</strong>.</p>${
      tracking ? `<p>Guía: <strong>${escapeHtml(tracking)}</strong></p>` : ""
    }${trackingUrl ? button("Rastrear envío", trackingUrl, color(d)) : d.orderUrl ? button("Ver mi pedido", d.orderUrl, color(d)) : ""}`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Enviamos tu pedido ${d.order.display_number}.`,
      tracking ? `Guía: ${tracking}` : "",
      trackingUrl ?? d.orderUrl ?? "",
    ],
  );
}

/** Entrega + invitación a opinar (ADR-029): la opinión se deja en la página del pedido. */
export function orderDeliveredEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `Tu pedido ${d.order.display_number} fue entregado`;
  const reviewUrl = d.orderUrl ? `${d.orderUrl}#opinar` : null;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Tu pedido <strong>${escapeHtml(d.order.display_number)}</strong> fue entregado. ¡Gracias por tu compra!</p><p>¿Qué te pareció? Tu opinión ayuda a otros clientes a elegir.</p>${
      reviewUrl ? button("Opinar sobre mi compra", reviewUrl, color(d)) : ""
    }`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Tu pedido ${d.order.display_number} fue entregado. ¡Gracias por tu compra!`,
      "¿Qué te pareció? Tu opinión ayuda a otros clientes a elegir.",
      reviewUrl ?? "",
    ],
  );
}

export function orderCancelledEmail(d: OrderEmailData, to: string): EmailMessage {
  const subject = `Tu pedido ${d.order.display_number} fue cancelado`;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Tu pedido <strong>${escapeHtml(d.order.display_number)}</strong> fue cancelado. Si ya lo habías pagado, te avisaremos cuando se acredite el reembolso.</p>`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Tu pedido ${d.order.display_number} fue cancelado. Si ya lo habías pagado, te avisaremos cuando se acredite el reembolso.`,
    ],
  );
}

export function refundIssuedEmail(d: OrderEmailData, to: string): EmailMessage {
  const amount = money(d.refund?.amount ?? 0, d);
  const subject = `Reembolso de ${amount} para tu pedido ${d.order.display_number}`;
  return message(
    d,
    to,
    subject,
    `<p>Hola, ${escapeHtml(d.order.customer_name)}:</p><p>Hicimos un reembolso de <strong>${escapeHtml(amount)}</strong> de tu pedido ${escapeHtml(d.order.display_number)}. Según tu banco o medio de pago, puede tardar unos días en verse.</p>`,
    [
      `Hola, ${d.order.customer_name}:`,
      "",
      `Hicimos un reembolso de ${amount} de tu pedido ${d.order.display_number}.`,
    ],
  );
}

export type StaffEmailKind = "new" | "paid" | "attention" | "paid_after_cancel";

/** Staff: pedido nuevo, pagado o que requiere atención (sin PII más allá del número y el total). */
export function staffOrderEmail(
  d: OrderEmailData,
  to: string,
  kind: StaffEmailKind,
  panelUrl: string,
): EmailMessage {
  const n = d.order.display_number;
  const { subject, body } = {
    new: {
      subject: `Nuevo pedido ${n} (${money(d.order.total, d)})`,
      body: "Llegó un pedido nuevo (pendiente de pago).",
    },
    paid: {
      subject: `Pedido pagado ${n}: por preparar`,
      body: "El pedido está pagado y listo para prepararse.",
    },
    attention: {
      subject: `Atención: pedido ${n} pagado sin existencias`,
      body: "El pago llegó después de vencer el pedido y ya no hay existencias. Iniciamos el reembolso automáticamente; revisa que se complete.",
    },
    paid_after_cancel: {
      subject: `Atención: pago recibido en el pedido cancelado ${n}`,
      body: "El comprador pagó después de que cancelaste el pedido. El pedido sigue cancelado e iniciamos el reembolso automáticamente; revisa que se complete.",
    },
  }[kind];
  return {
    to,
    subject,
    html: layout(
      d,
      subject,
      `<p>${escapeHtml(body)}</p>${itemsHtml(d)}${button("Abrir en el panel", panelUrl, "#1a1a1a")}`,
    ),
    text: [body, "", itemsText(d), `Panel: ${panelUrl}`].join("\n"),
  };
}
