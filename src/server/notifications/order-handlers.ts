import { createHash } from "node:crypto";

import { applyStoreText, EDITABLE_KEYS } from "@/lib/emails/store-texts";
import { log } from "@/server/observability/logger";
import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";
import { guestToken } from "@/server/payments/order-links";

import { alreadyDelivered, payloadId, sendNotification } from "./handlers";
import { fetchStoreText } from "./store-texts-db";
import {
  orderCancelledEmail,
  orderLinkEmail,
  orderConfirmationEmail,
  orderPendingPaymentEmail,
  orderDeliveredEmail,
  orderReceivedEmail,
  orderShippedEmail,
  paymentFailedEmail,
  refundIssuedEmail,
  returnDecisionEmail,
  returnRequestedEmail,
  type ReturnEmailData,
  staffOrderEmail,
  staffReturnEmail,
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
    /** ADR-062: generación vigente del enlace (0 = la del checkout). */
    guest_link_generation?: number;
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
          ? `${origin}/pedido/${n.order.id}?t=${encodeURIComponent(
              guestToken(deps.linkSecret, key, n.order.guest_link_generation ?? 0),
            )}`
          : null,
      payment: n.payment,
      shipment: n.shipment ?? null,
      refund: n.refund ?? null,
    };
  }

  // Si falla la lectura, el correo sale con el texto de siempre (fetchStoreText).
  const storeText = (storeId: string, template: string) =>
    fetchStoreText(deps.db, storeId, template, log);

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
    // Paso 20: asunto y mensaje de la tienda (solo correos del comprador y con el interruptor).
    const final = EDITABLE_KEYS.has(template)
      ? applyStoreText(message, await storeText(n.store.id, template), {
          nombre: n.order.customer_name,
          pedido: n.order.display_number,
          tienda: n.store.name,
        })
      : message;
    await sendNotification(deps, {
      dedupeKey,
      template,
      organizationId: n.store.organization_id,
      idempotencyKey: dedupeKey,
      message: final,
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

  /** ADR-056: pago diferido de Mercado Pago aún sin pagar. Una vez por intento. */
  const pending: JobHandler = async (job, { log }) => {
    const paymentId = payloadId(job, "payment_id");
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    // Si ya se pagó, se canceló o venció mientras esperaba, el aviso ya no sirve.
    if (n.order.status !== "pending_payment" || n.order.payment_status === "paid") return;
    const method = typeof job.payload.method === "string" ? job.payload.method : null;
    await deliver(
      job,
      n,
      paymentId,
      "order_pending_payment",
      orderPendingPaymentEmail(emailData(n), n.order.email, method),
    );
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

  /** ADR-062: enlace nuevo del pedido, solo al correo del pedido. Una vez por generación. */
  const linkRenewed: JobHandler = async (job, { log }) => {
    const generation = (job.payload as { generation?: unknown }).generation;
    const n = await load(job);
    if (!n) return log.info("Pedido inexistente: nada que avisar");
    // Si ya se pidió otro enlace, este correo llevaría uno que ya no sirve.
    if (typeof generation !== "number" || n.order.guest_link_generation !== generation) return;
    await deliver(
      job,
      n,
      `${n.order.id}:g${generation}`,
      "order_link",
      orderLinkEmail(emailData(n), n.order.email),
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

  // ADR-061: devoluciones. Los datos de la solicitud vienen de la base, igual que
  // los del pedido; cada correo tiene su clave (devolución + plantilla + destinatario).
  async function loadReturn(job: JobRecord): Promise<ReturnEmailData | null> {
    const [row] = await deps.db<{ value: ReturnEmailData | null }[]>`
      select system.return_notification(${payloadId(job, "return_id")}::uuid) as value`;
    return row?.value ?? null;
  }

  const returnRequested: JobHandler = async (job, { log }) => {
    const n = await load(job);
    const r = n ? await loadReturn(job) : null;
    if (!n || !r) return log.info("Devolución inexistente: nada que avisar");
    const returnId = payloadId(job, "return_id");
    const data = emailData(n);
    await deliver(
      job,
      n,
      returnId,
      "return_requested",
      returnRequestedEmail(data, r, n.order.email),
    );
    const panel = new URL(
      `/admin/${encodeURIComponent(n.store.handle)}/pedidos/devoluciones/${returnId}`,
      deps.appUrl,
    ).toString();
    for (const to of n.staff.emails) {
      await deliver(
        job,
        n,
        returnId,
        "staff_return_requested",
        staffReturnEmail(data, r, to, panel),
      );
    }
  };

  const returnDecided =
    (approved: boolean): JobHandler =>
    async (job, { log }) => {
      const n = await load(job);
      const r = n ? await loadReturn(job) : null;
      if (!n || !r) return log.info("Devolución inexistente: nada que avisar");
      await deliver(
        job,
        n,
        payloadId(job, "return_id"),
        approved ? "return_approved" : "return_rejected",
        returnDecisionEmail(emailData(n), r, n.order.email, approved),
      );
    };

  return [
    ["order.created", created],
    ["order.paid", paid],
    ["payment.failed", failed],
    ["payment.pending", pending],
    ["order.shipped", shipped],
    ["order.delivered", delivered],
    ["order.cancelled", cancelled],
    ["refund.succeeded", refunded],
    ["payment.late_without_stock", lateWithoutStock],
    ["payment.after_cancel", afterCancel],
    ["payment.external_reversal", externalReversal],
    ["return.requested", returnRequested],
    ["return.approved", returnDecided(true)],
    ["return.rejected", returnDecided(false)],
    ["order.link_renewed", linkRenewed],
  ];
}
