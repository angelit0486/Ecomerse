import {
  orderReceivedMessage,
  paymentConfirmedMessage,
  readyForPickupMessage,
  shippedMessage,
  whatsappChatUrl,
  whatsappNumber,
} from "./order-messages";

/**
 * Qué avisos por WhatsApp ofrece el panel para un pedido (D-INT-03), según su
 * estado. Cada aviso es un enlace `wa.me` con el mensaje escrito; quien atiende
 * el pedido solo toca «Enviar» en su WhatsApp.
 */
export interface NoticeOrder {
  displayNumber: string;
  status: string;
  paidTotal: number;
  /** Total ya formateado. */
  total: string;
  pickup: boolean;
}

export interface NoticeShipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface WhatsappNotice {
  key: string;
  label: string;
  url: string;
}

export type NoticesResult =
  { ok: true; notices: WhatsappNotice[] } | { ok: false; reason: "no_phone" | "bad_phone" };

export function orderWhatsappNotices(input: {
  storeName: string;
  storeCountry: string;
  customerName: string;
  customerPhone: string | null;
  order: NoticeOrder;
  shipments: NoticeShipment[];
  paymentInstructions: string | null;
}): NoticesResult {
  if (!input.customerPhone?.trim()) return { ok: false, reason: "no_phone" };
  const number = whatsappNumber(input.customerPhone, input.storeCountry);
  if (!number) return { ok: false, reason: "bad_phone" };
  const base = {
    storeName: input.storeName,
    customerName: input.customerName,
    displayNumber: input.order.displayNumber,
    total: input.order.total,
  };
  const link = (key: string, label: string, text: string) => ({
    key,
    label,
    url: whatsappChatUrl(number, text),
  });
  const notices: WhatsappNotice[] = [];
  if (input.order.status === "cancelled") return { ok: true, notices };
  if (input.order.status === "pending_payment") {
    notices.push(
      link(
        "received",
        "Pedido recibido",
        orderReceivedMessage({ ...base, instructions: input.paymentInstructions }),
      ),
    );
  }
  if (input.order.paidTotal > 0) {
    notices.push(link("paid", "Pago confirmado", paymentConfirmedMessage(base)));
    if (input.order.pickup)
      notices.push(link("pickup", "Listo para recoger", readyForPickupMessage(base)));
  }
  for (const s of input.shipments) {
    if (!s.trackingNumber && !s.trackingUrl) continue;
    notices.push(
      link(
        `shipped-${s.id}`,
        input.shipments.length > 1
          ? `Enviado (guía ${s.trackingNumber ?? ""})`.replace(" ()", "")
          : "Enviado con guía",
        shippedMessage({
          ...base,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          trackingUrl: s.trackingUrl,
        }),
      ),
    );
  }
  return { ok: true, notices };
}
