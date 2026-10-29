import { createHash } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";
import { guestToken } from "@/server/payments/order-links";

import { alreadyDelivered, payloadId, sendNotification } from "./handlers";
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderDeliveredEmail,
  orderReceivedEmail,
  orderShippedEmail,
  paymentFailedEmail,
  refundIssuedEmail,
  staffOrderEmail,
  type OrderEmailData,
  type StaffEmailKind,
} from "./order-templates";
import { isEmail, type EmailChannel, type EmailMessage } from "./types";

/**
 * Notificaciones de pedidos (GATE0 §27.2-27.3). Cada envío tiene una clave
 * `{job}:{entidad}:{plantilla}:{hash del destinatario}`: reprocesar el job no
 * reenvía, y si un destinatario falla el reintento solo envía lo pendiente.
 * El pedido de pago diferido avisa al comprador y a la tienda al crearse; el
 * de pago en línea, al pagarse (D-F7-04).
 */
export interface OrderNotificationDeps {
  db: Sql;
  channel: EmailChannel;
  linkSecret: string;
  /** Origen público de la tienda a partir de su hostname. */
  storeOrigin: (hostname: string) => string;
  /** URL pública de un objeto de store-media (la plantilla solo usa https). */
  mediaUrl: (path: string) => string;
  appUrl: string;
}

interface OrderNotification {
  store: {
    id: string;
    handle: string;
    name: string;
    locale: string;
    currency: string;
    contact_email: string | null;
    organization_id: string;
    hostname: string | null;
    logo_path: string | null;
    primary_color: string | null;
  };
  order: OrderEmailData["order"] & {
    id: string;
    email: string;
    status: string;
    payment_status: string;
    checkout_idempotency_key: string | null;
  };
  items: (Omit<OrderEmailData["items"][number], "image_url"> & { image_path?: string | null })[];
  payment: {
    provider: string;
    status: string;
    display_name: string;
    instructions: string | null;
    method: string | null;
  } | null;
  shipment: OrderEmailData["shipment"];
  refund: OrderEmailData["refund"];
  staff: { emails: string[]; notify_new_order: boolean; notify_paid: boolean };
}

const DEFERRED_PROVIDERS = new Set(["manual"]);

function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function createOrderNotificationHandlers(
  deps: OrderNotificationDeps,
): Array<[string, JobHandler]> {
  async function load(job: JobRecord, extra: { shipment?: string; refund?: string } = {}) {
    const orderId = payloadId(job, "order_id");
    const [row] = await deps.db<{ value: OrderNotification | null }[]>`
      select system.order_notification(${orderId}::uuid, ${extra.shipment ?? null}::uuid,
                                       ${extra.refund ?? null}::uuid) as value`;
    const n = row?.value ?? null;
    // Un job de otra tienda nunca obtiene datos de este pedido.
    if (n && job.storeId && n.store.id !== job.storeId) {
      throw new PermanentJobError("store_id del job no coincide con el pedido");
    }
    return n;
  }

  function emailData(n: OrderNotification): OrderEmailData {
    const origin = n.store.hostname ? deps.storeOrigin(n.store.hostname) : null;
    const key = n.order.checkout_idempotency_key;
    const logo = n.store.logo_path ? deps.mediaUrl(n.store.logo_path) : null;
    return {
      store: {
        name: n.store.name,
        locale: n.store.locale,
        currency: n.store.currency,
        contact_email:
          n.store.contact_email && isEmail(n.store.contact_email) ? n.store.contact_email : null,
        logoUrl: logo,
        primary_color: n.store.primary_color,
      },
      order: n.order,
      // Miniatura solo si es una ruta del almacenamiento (la plantilla exige https).
      items: n.items.map(({ image_path, ...item }) => ({
        ...item,
        image_url: image_path ? deps.mediaUrl(image_path) : null,
      })),
      orderUrl:
        origin && key
          ? `${origin}/pedido/${n.order.id}?t=${encodeURIComponent(guestToken(deps.linkSecret, key))}`
          : null,
      payment: n.payment,
      shipment: n.shipment ?? null,
      refund: n.refund ?? null,
    };
  }

  async function deliver(
    job: JobRecord,
    n: OrderNotification,
    entity: string,
    template: string,
    message: EmailMessage,
  ): Promise<void> {
    if (!isEmail(message.to)) return;
    const dedupeKey = `${job.type}:${entity}:${template}:${recipientHash(message.to)}`;
    if (await alreadyDelivered(deps.db, dedupeKey)) return;
    await sendNotification(deps, {
      dedupeKey,
      template,
      organizationId: n.store.organization_id,
      idempotencyKey: dedupeKey,
      message,
    });
  }

  async function notifyStaff(job: JobRecord, n: OrderNotification, kind: StaffEmailKind) {
    const data = emailData(n);
    const panel = new URL(
      `/admin/${encodeURIComponent(n.store.handle)}/pedidos/${n.order.id}`,
      deps.appUrl,
    ).toString();
    for (const to of n.staff.emails) {
      await deliver(
        job,
        n,
        n.order.id,
        `staff_order_${kind}`,
        staffOrderEmail(data, to, kind, panel),
      );
    }
  }

  const created: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    if (!n.payment || !DEFERRED_PROVIDERS.has(n.payment.provider)) return;
    if (n.order.status !== "pending_payment") return;
    await deliver(
      job,
      n,
      n.order.id,
      "order_received",
      orderReceivedEmail(emailData(n), n.order.email),
    );
    if (n.staff.notify_new_order) await notifyStaff(job, n, "new");
  };

  const paid: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    if (n.order.status === "cancelled") return;
    await deliver(
      job,
      n,
      n.order.id,
      "order_confirmation",
      orderConfirmationEmail(emailData(n), n.order.email),
    );
    if (n.staff.notify_paid) await notifyStaff(job, n, "paid");
  };

  const failed: JobHandler = async (job, { log }) => {
    const paymentId = payloadId(job, "payment_id");
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    // Si ya se pagó con otro intento o venció, el aviso ya no sirve.
    if (n.order.status !== "pending_payment" || n.order.payment_status !== "failed") return;
    await deliver(
      job,
      n,
      paymentId,
      "payment_failed",
      paymentFailedEmail(emailData(n), n.order.email),
    );
  };

  const shipped: JobHandler = async (job, { log }) => {
    const shipmentId = payloadId(job, "shipment_id");
    const n = await load(job, { shipment: shipmentId });
    if (!n?.shipment) return log.info("Envío inexistente: nada que avisar");
    await deliver(
      job,
      n,
      shipmentId,
      "order_shipped",
      orderShippedEmail(emailData(n), n.order.email),
    );
  };

  const delivered: JobHandler = async (job, { log }) => {
    const shipmentId = payloadId(job, "shipment_id");
    const n = await load(job, { shipment: shipmentId });
    if (!n?.shipment) return log.info("Envío inexistente: nada que avisar");
    await deliver(
      job,
      n,
      shipmentId,
      "order_delivered",
      orderDeliveredEmail(emailData(n), n.order.email, {
        inviteReview: ["paid", "partially_refunded"].includes(n.order.payment_status),
      }),
    );
  };

  const cancelled: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    await deliver(
      job,
      n,
      n.order.id,
      "order_cancelled",
      orderCancelledEmail(emailData(n), n.order.email),
    );
  };

  const refunded: JobHandler = async (job, { log }) => {
    const refundId = payloadId(job, "refund_id");
    const n = await load(job, { refund: refundId });
    if (!n?.refund) return log.info("Reembolso no confirmado: nada que avisar");
    await deliver(
      job,
      n,
      refundId,
      "refund_issued",
      refundIssuedEmail(emailData(n), n.order.email),
    );
  };

  const afterCancel: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    await notifyStaff(job, n, "paid_after_cancel");
  };

  const lateWithoutStock: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    await notifyStaff(job, n, "attention");
  };

  // ADR-043: contracargo o reembolso hecho fuera de la plataforma.
  const externalReversal: JobHandler = async (job, { log }) => {
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    const reason = (job.payload as { reason?: unknown }).reason;
    await notifyStaff(job, n, reason === "chargeback" ? "chargeback" : "external_refund");
  };

  return [
    ["order.created", created],
    ["order.paid", paid],
    ["payment.failed", failed],
    ["order.shipped", shipped],
    ["order.delivered", delivered],
    ["order.cancelled", cancelled],
    ["refund.succeeded", refunded],
    ["payment.late_without_stock", lateWithoutStock],
    ["payment.after_cancel", afterCancel],
    ["payment.external_reversal", externalReversal],
  ];
}
