import { randomBytes } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { centsToInput, formatMoney } from "@/lib/money/format";
import {
  axisValueLabel,
  paymentAttemptLabel,
  paymentProviderLabel,
} from "@/lib/orders/axis-labels";
import { visibleStatus } from "@/lib/orders/visible-status";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { getOrderSupplierOrders } from "@/server/orders/supplier-orders";
import { createSupabaseServerClient } from "@/server/supabase/server";

import {
  CancelForm,
  CloseUnshippedForm,
  ResolveAttentionForm,
  ConfirmPaymentForm,
  DeliveredButton,
  FulfillForm,
  RefundForm,
  StaffNoteForm,
} from "../order-forms";
import { SupplierOrderCard } from "../despachos/supplier-order-card";

export const metadata: Metadata = { title: "Pedido" };

type Props = {
  params: Promise<{ storeHandle: string; orderId: string }>;
  searchParams: Promise<{ aviso?: string }>;
};

/** Avisos tras una operación (texto fijo: el parámetro nunca se muestra tal cual). */
const NOTICES: Record<string, string> = {
  envio: "Envío registrado. Avisamos al cliente por email.",
  entregado: "Envío marcado como entregado.",
  cancelado: "Pedido cancelado.",
  reembolso: "Reembolso solicitado. El monto se aplica cuando el proveedor lo confirma.",
  cerrado: "Unidades no enviadas cerradas.",
  resuelto: "Atención marcada como resuelta.",
};

interface Contact {
  email: string;
  phone: string | null;
  customer_name: string;
  shipping_address: Record<string, string> | null;
  customer_note: string | null;
  staff_note: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  "order.created": "Pedido recibido",
  "order.status_changed": "Estado",
  "order.payment_changed": "Pago",
  "order.fulfillment_changed": "Envío",
  "payment.confirmed_manually": "Pago confirmado manualmente",
  "order.shipped": "Envío registrado",
  "order.delivered": "Envío entregado",
  "order.cancelled": "Pedido cancelado",
  "refund.requested": "Reembolso solicitado",
  "refund.succeeded": "Reembolso confirmado",
  "refund.failed": "Reembolso fallido",
  "payment.late": "Pago tardío",
  "payment.late_without_stock": "Pago tardío sin existencias",
  "payment.duplicate": "Pago duplicado",
  "payment.mismatch": "Pago con monto o moneda distintos",
  "payment.after_cancel": "Pago recibido después de cancelar",
  "refund.stuck": "Reembolso sin confirmar",
  "attention.resolved": "Atención resuelta",
  "order.unshipped_closed": "Unidades no enviadas cerradas",
  "supplier_order.created": "Despacho de proveedor",
  "supplier_order.updated": "Despacho de proveedor",
  "supplier_order.cancelled": "Despacho de proveedor cancelado",
};

const SHIPMENT_STATUS: Record<string, string> = {
  pending: "Pendiente",
  shipped: "En camino",
  delivered: "Entregado",
  returned: "Devuelto",
  cancelled: "Cancelado",
};
const REFUND_STATUS: Record<string, string> = {
  pending: "En proceso",
  succeeded: "Reembolsado",
  failed: "Falló",
};

/** Clave de idempotencia de un formulario renderizado (§16.4). */
const formKey = () => randomBytes(18).toString("base64url");

export default async function OrderDetailPage({ params, searchParams }: Props) {
  const { storeHandle, orderId } = await params;
  const notice = NOTICES[(await searchParams).aviso ?? ""];
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read") || !/^[0-9a-f-]{36}$/.test(orderId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, display_number, placed_at, currency, prices_include_tax, subtotal, discount_total, shipping_total, tax_total, total, paid_total, refunded_total, status, payment_status, fulfillment_status, needs_attention, cancel_reason, shipping_snapshot, discount_snapshot",
    )
    .eq("store_id", ctx.store.id)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) notFound();
  const canPayments = hasPermission(ctx, "payments.read");
  const canPii = hasPermission(ctx, "customers.pii.read");
  const [items, events, payments, contact, shipments, shipmentItems, refunds] = await Promise.all([
    supabase
      .from("order_items")
      .select(
        "id, product_title, variant_title, sku, quantity, unit_price, discount_allocation, line_total, refunded_quantity, cancelled_quantity",
      )
      .eq("store_id", ctx.store.id)
      .eq("order_id", orderId)
      .order("position"),
    supabase
      .from("order_events")
      .select("id, type, from_value, to_value, message, actor_type, created_at")
      .eq("store_id", ctx.store.id)
      .eq("order_id", orderId)
      .order("created_at"),
    canPayments
      ? supabase
          .from("payments")
          .select("id, provider, status, amount, created_at")
          .eq("store_id", ctx.store.id)
          .eq("order_id", orderId)
          .order("created_at")
      : Promise.resolve({ data: null, error: null }),
    canPii
      ? callRpc<Contact>(supabase, "orders_get_contact", {
          p_store_id: ctx.store.id,
          p_order_id: orderId,
        })
      : Promise.resolve(null),
    supabase
      .from("shipments")
      .select("id, status, carrier, tracking_number, tracking_url, shipped_at, delivered_at")
      .eq("store_id", ctx.store.id)
      .eq("order_id", orderId)
      .order("created_at"),
    supabase
      .from("shipment_items")
      .select("shipment_id, order_item_id, quantity, shipments!inner(order_id)")
      .eq("store_id", ctx.store.id)
      .eq("shipments.order_id", orderId),
    supabase
      .from("refunds")
      .select("id, amount, status, reason, items, created_at")
      .eq("store_id", ctx.store.id)
      .eq("order_id", orderId)
      .order("created_at"),
  ]);
  for (const r of [items, events, shipments, shipmentItems, refunds]) if (r.error) throw r.error;
  const supplierOrders = await getOrderSupplierOrders(supabase, ctx.store.id, orderId);
  const m = (cents: number) => formatMoney(cents, order.currency as string);
  // Fechas en el calendario de la tienda (el servidor corre en UTC).
  const when = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });
  const lastPayment = payments.data?.at(-1) as { provider: string; status: string } | undefined;
  const canConfirm =
    hasPermission(ctx, "orders.update") &&
    order.status === "pending_payment" &&
    lastPayment?.provider === "manual" &&
    ["created", "pending"].includes(lastPayment.status);

  const shippedByItem = new Map<string, number>();
  for (const si of shipmentItems.data ?? []) {
    const id = si.order_item_id as string;
    shippedByItem.set(id, (shippedByItem.get(id) ?? 0) + (si.quantity as number));
  }
  const lineLabel = (i: { product_title: unknown; variant_title: unknown }) =>
    `${i.product_title as string}${i.variant_title ? ` (${i.variant_title as string})` : ""}`;
  const fulfillLines = (items.data ?? [])
    .map((i) => ({
      id: i.id as string,
      label: lineLabel(i),
      pending:
        (i.quantity as number) -
        (shippedByItem.get(i.id as string) ?? 0) -
        ((i.cancelled_quantity as number | undefined) ?? 0),
    }))
    .filter((l) => l.pending > 0);
  // Unidades ya comprometidas en reembolsos pendientes (la base aplica el mismo límite).
  const pendingUnits = new Map<string, number>();
  for (const r of refunds.data ?? []) {
    if (r.status !== "pending") continue;
    for (const it of (r.items as { order_item_id: string; quantity: number }[] | null) ?? []) {
      pendingUnits.set(it.order_item_id, (pendingUnits.get(it.order_item_id) ?? 0) + it.quantity);
    }
  }
  const returnLines = (items.data ?? [])
    .map((i) => ({
      id: i.id as string,
      label: lineLabel(i),
      shipped:
        (shippedByItem.get(i.id as string) ?? 0) -
        ((i.refunded_quantity as number | undefined) ?? 0) -
        (pendingUnits.get(i.id as string) ?? 0),
    }))
    .filter((l) => l.shipped > 0);
  const pendingRefunds = (refunds.data ?? [])
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + (r.amount as number), 0);
  const refundable =
    (order.paid_total as number) - (order.refunded_total as number) - pendingRefunds;
  const isPaid = ["paid", "partially_refunded"].includes(order.payment_status as string);
  const canFulfill =
    hasPermission(ctx, "orders.fulfill") &&
    order.status === "open" &&
    isPaid &&
    fulfillLines.length > 0;
  const canRefund = hasPermission(ctx, "orders.refund") && refundable > 0;
  const canCloseUnshipped =
    hasPermission(ctx, "orders.cancel") &&
    order.status === "open" &&
    shippedByItem.size > 0 &&
    fulfillLines.length > 0;
  const canResolve = hasPermission(ctx, "orders.update") && order.needs_attention === true;
  const canCancel =
    hasPermission(ctx, "orders.cancel") &&
    ["pending_payment", "open"].includes(order.status as string) &&
    shippedByItem.size === 0;

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/pedidos`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Pedidos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Pedido {order.display_number as string}</h1>
        <p className="text-sm text-fg-muted">
          {visibleStatus(order as never)} · {when.format(new Date(order.placed_at as string))}
        </p>
      </header>

      {notice ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm text-success">
          {notice}
        </p>
      ) : null}

      {order.needs_attention ? (
        <section
          aria-labelledby="atencion"
          className="space-y-2 rounded-md border border-warning p-4"
        >
          <h2 id="atencion" className="font-semibold">
            Este pedido necesita atención
          </h2>
          <p className="text-sm">
            Revisa el historial: puede haber un cobro duplicado, un pago después de cancelar o un
            reembolso que no se confirmó. Un cobro duplicado se reembolsa desde el panel de tu
            proveedor de pagos.
          </p>
          {canResolve ? (
            <ResolveAttentionForm storeHandle={ctx.store.handle} orderId={orderId} />
          ) : null}
        </section>
      ) : null}

      {canConfirm ? (
        <section
          aria-labelledby="pago-manual"
          className="space-y-2 rounded-md border border-warning p-4"
        >
          <h2 id="pago-manual" className="font-semibold">
            Pago pendiente de confirmar
          </h2>
          <p className="text-sm">
            Confírmalo solo cuando hayas recibido el dinero. Queda registrado quién lo confirmó.
          </p>
          <ConfirmPaymentForm storeHandle={ctx.store.handle} orderId={orderId} />
        </section>
      ) : null}

      <section aria-labelledby="partidas" className="space-y-2">
        <h2 id="partidas" className="font-semibold">
          Productos
        </h2>
        <ul className="divide-y divide-border text-sm">
          {(items.data ?? []).map((i) => (
            <li key={i.id as string} className="flex justify-between gap-4 py-2">
              <span>
                {i.quantity as number} × {i.product_title as string}
                {i.variant_title ? ` (${i.variant_title as string})` : ""}
                {i.sku ? <span className="text-fg-muted"> · {i.sku as string}</span> : null}
              </span>
              <span>{m(i.line_total as number)}</span>
            </li>
          ))}
        </ul>
        <dl className="max-w-sm space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{m(order.subtotal as number)}</dd>
          </div>
          {(order.discount_total as number) > 0 ? (
            <div className="flex justify-between">
              <dt>Descuento {(order.discount_snapshot as { code?: string } | null)?.code ?? ""}</dt>
              <dd>−{m(order.discount_total as number)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt>Envío {(order.shipping_snapshot as { name?: string } | null)?.name ?? ""}</dt>
            <dd>{m(order.shipping_total as number)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{order.prices_include_tax ? "Impuestos incluidos" : "Impuestos"}</dt>
            <dd>{m(order.tax_total as number)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd>{m(order.total as number)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Pagado</dt>
            <dd>{m(order.paid_total as number)}</dd>
          </div>
        </dl>
      </section>

      {(shipments.data ?? []).length > 0 ? (
        <section aria-labelledby="envios" className="space-y-2 text-sm">
          <h2 id="envios" className="font-semibold">
            Envíos
          </h2>
          <ul className="space-y-2">
            {(shipments.data ?? []).map((sh) => (
              <li key={sh.id as string} className="flex flex-wrap items-center gap-3">
                <span>
                  {SHIPMENT_STATUS[sh.status as string] ?? (sh.status as string)}
                  {sh.carrier ? ` · ${sh.carrier as string}` : ""}
                  {sh.tracking_number ? ` · ${sh.tracking_number as string}` : ""}
                </span>
                {sh.tracking_url ? (
                  <a
                    href={sh.tracking_url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Rastrear
                  </a>
                ) : null}
                {sh.status === "shipped" && hasPermission(ctx, "orders.fulfill") ? (
                  <DeliveredButton
                    storeHandle={ctx.store.handle}
                    orderId={orderId}
                    shipmentId={sh.id as string}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {supplierOrders.length > 0 ? (
        <section aria-labelledby="despachos" className="space-y-2">
          <h2 id="despachos" className="font-semibold">
            Despachos de proveedores
          </h2>
          <p className="text-sm text-fg-muted">
            Estas piezas las envía el proveedor. Regístralas en «Surtir y enviar» cuando el
            proveedor te dé la guía.
          </p>
          {supplierOrders.map((so) => (
            <SupplierOrderCard
              key={so.id}
              storeHandle={ctx.store.handle}
              timeZone={ctx.store.timezone}
              supplierOrder={so}
              canUpdate={hasPermission(ctx, "orders.update")}
            />
          ))}
        </section>
      ) : null}

      {canFulfill ? (
        <section aria-labelledby="surtir" className="space-y-2 rounded-md border border-border p-4">
          <h2 id="surtir" className="font-semibold">
            Surtir y enviar
          </h2>
          <FulfillForm
            storeHandle={ctx.store.handle}
            orderId={orderId}
            lines={fulfillLines}
            idempotencyKey={formKey()}
          />
        </section>
      ) : null}

      {canCloseUnshipped ? (
        <section
          aria-labelledby="cerrar-pendientes"
          className="space-y-2 rounded-md border border-border p-4"
        >
          <h2 id="cerrar-pendientes" className="font-semibold">
            Unidades que no se enviarán
          </h2>
          <p className="text-sm text-fg-muted">
            Libera las existencias apartadas para las unidades pendientes y permite completar el
            pedido.
          </p>
          <CloseUnshippedForm
            storeHandle={ctx.store.handle}
            orderId={orderId}
            idempotencyKey={formKey()}
            canRefund={hasPermission(ctx, "orders.refund") && refundable > 0}
          />
        </section>
      ) : null}

      {(refunds.data ?? []).length > 0 ? (
        <section aria-labelledby="reembolsos" className="space-y-2 text-sm">
          <h2 id="reembolsos" className="font-semibold">
            Reembolsos
          </h2>
          <ul className="space-y-1">
            {(refunds.data ?? []).map((r) => (
              <li key={r.id as string}>
                {m(r.amount as number)} ·{" "}
                {REFUND_STATUS[r.status as string] ?? (r.status as string)}
                {r.reason ? ` · ${r.reason as string}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canRefund ? (
        // Plegados (paso 13): acciones de dinero que se usan poco no empujan el
        // resto del pedido; se abren con un toque y siguen pidiendo confirmación.
        <details className="rounded-md border border-border p-4">
          <summary className="flex min-h-11 cursor-pointer items-center md:min-h-0">
            <h2 id="reembolsar" className="font-semibold">
              Reembolsar dinero
            </h2>
          </summary>
          <div className="mt-3 space-y-2">
            <RefundForm
              storeHandle={ctx.store.handle}
              orderId={orderId}
              idempotencyKey={formKey()}
              maxAmount={centsToInput(refundable)}
              maxLabel={m(refundable)}
              lines={returnLines}
            />
          </div>
        </details>
      ) : null}

      {canCancel ? (
        <details className="rounded-md border border-danger p-4">
          <summary className="flex min-h-11 cursor-pointer items-center md:min-h-0">
            <h2 id="cancelar" className="font-semibold">
              Cancelar el pedido
            </h2>
          </summary>
          <div className="mt-3 space-y-2">
            <CancelForm
              storeHandle={ctx.store.handle}
              orderId={orderId}
              idempotencyKey={formKey()}
              willRefund={isPaid && refundable > 0}
            />
          </div>
        </details>
      ) : null}

      {contact ? (
        <section aria-labelledby="cliente" className="space-y-2 text-sm">
          <h2 id="cliente" className="font-semibold">
            Cliente
          </h2>
          <p>
            {contact.customer_name} · {contact.email}
            {contact.phone ? ` · ${contact.phone}` : ""}
          </p>
          {contact.shipping_address ? (
            <p>
              {contact.shipping_address.line1}
              {contact.shipping_address.line2 ? `, ${contact.shipping_address.line2}` : ""},{" "}
              {contact.shipping_address.postal_code} {contact.shipping_address.city},{" "}
              {contact.shipping_address.region}, {contact.shipping_address.country}
            </p>
          ) : null}
          {contact.customer_note ? <p>Nota del cliente: {contact.customer_note}</p> : null}
          {hasPermission(ctx, "orders.update") ? (
            <StaffNoteForm
              storeHandle={ctx.store.handle}
              orderId={orderId}
              note={contact.staff_note ?? ""}
            />
          ) : null}
        </section>
      ) : (
        <p className="text-sm text-fg-muted">
          Los datos de contacto requieren el permiso de datos personales.
        </p>
      )}

      {payments.data ? (
        <section aria-labelledby="pagos" className="space-y-2 text-sm">
          <h2 id="pagos" className="font-semibold">
            Intentos de pago
          </h2>
          <ul className="space-y-1">
            {payments.data.map((p) => (
              <li key={p.id as string}>
                {paymentProviderLabel(p.provider as string)} ·{" "}
                {paymentAttemptLabel(p.status as string)} · {m(p.amount as number)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="historial" className="space-y-2 text-sm">
        <h2 id="historial" className="font-semibold">
          Historial
        </h2>
        <ol className="space-y-1">
          {(events.data ?? []).map((e) => (
            <li key={e.id as string}>
              <time dateTime={e.created_at as string} className="text-fg-muted tabular-nums">
                {when.format(new Date(e.created_at as string))}
              </time>{" "}
              · {EVENT_LABELS[e.type as string] ?? (e.type as string)}
              {e.to_value
                ? `: ${axisValueLabel(e.from_value as string | null)} → ${axisValueLabel(e.to_value as string)}`
                : ""}
              {e.message ? ` · ${e.message as string}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
