import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { deliveryEstimate } from "@/lib/orders/delivery-estimate";
import { visibleStatus } from "@/lib/orders/visible-status";
import { isGuestTokenShape } from "@/server/payments/order-links";
import { guestOrder } from "@/server/storefront/checkout";
import { mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { orderReviewables } from "@/server/storefront/reviews";

import { money } from "../../_components/format";
import { Totals } from "../../_components/totals";
import { RetryPayment } from "./retry-form";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = {
  params: Promise<{ storeId: string; orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pedido del invitado (§16.5): solo con el token del enlace; si no, el mismo 404. */
export default async function OrderPage({ params, searchParams }: Props) {
  const { storeId, orderId } = await params;
  const { store } = await getStorefront(storeId);
  const t = (await searchParams).t;
  if (!UUID_RE.test(orderId) || typeof t !== "string" || !isGuestTokenShape(t)) notFound();
  const order = await guestOrder(store.id, orderId, t);
  if (!order) notFound();

  // Solo pedidos pagados y entregados ofrecen opinar (lo decide la base, ADR-029).
  const reviewables = await orderReviewables(store.id, order.id, t);
  const label = visibleStatus(order);
  const minutesLeft = order.minutes_left;
  const payment = order.payment;
  const canRetry =
    order.status === "pending_payment" &&
    payment &&
    ["failed", "expired", "cancelled"].includes(payment.status);

  // Fecha estimada solo mientras el pedido está pagado y en camino (revisión de
  // conversión, B4): no en pendientes de pago, cancelados, completados,
  // reembolsados o devueltos, ni cuando la fecha ya pasó.
  const inTransit =
    order.shipping &&
    ["paid", "processing", "open"].includes(order.status) &&
    order.payment_status === "paid" &&
    ["unfulfilled", "partially_fulfilled", "fulfilled"].includes(order.fulfillment_status);
  const arrival = inTransit
    ? deliveryEstimate({
        placedAt: order.placed_at,
        minDays: order.shipping!.est_days_min,
        maxDays: order.shipping!.est_days_max,
        timeZone: store.timezone,
        locale: store.locale,
        now: new Date(),
      })
    : null;

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-[var(--sf-muted)]">Pedido {order.display_number}</p>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          {order.status === "pending_payment" ? "Recibimos tu pedido" : "Gracias por tu compra"}
        </h1>
        <p role="status">
          Estado: <strong>{label}</strong>
        </p>
        <p className="text-sm text-[var(--sf-muted)]">
          Guarda esta página: el enlace es tu acceso al pedido.
        </p>
      </header>

      {order.status === "pending_payment" && payment ? (
        <section
          aria-labelledby="pago"
          className="space-y-3 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5"
        >
          <h2 id="pago" className="font-semibold">
            Pago: {payment.display_name}
          </h2>
          {payment.status === "failed" ? <p>El pago no se completó.</p> : null}
          {payment.provider === "manual" && payment.instructions ? (
            <p className="whitespace-pre-line text-sm">{payment.instructions}</p>
          ) : null}
          {payment.provider === "manual" ? (
            <p className="text-sm">
              La tienda confirmará tu pago y te avisaremos.
              {minutesLeft !== null
                ? ` Tus productos quedan apartados ${minutesLeft} minutos más.`
                : ""}
            </p>
          ) : null}
          {canRetry ? <RetryPayment storeId={store.id} orderId={order.id} token={t} /> : null}
        </section>
      ) : null}
      {order.status === "cancelled" && order.cancel_reason === "payment_expired" ? (
        <p>El tiempo para pagar este pedido terminó y se canceló. Puedes hacer un pedido nuevo.</p>
      ) : null}

      <section aria-labelledby="productos" className="space-y-3">
        <h2 id="productos" className="font-semibold">
          Productos
        </h2>
        <ul className="divide-y divide-[var(--sf-border)]">
          {order.items.map((item, i) => (
            <li key={i} className="flex items-center gap-4 py-3 text-sm">
              {item.image_path ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen del snapshot
                <img
                  src={mediaUrl(item.image_path)}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded object-cover"
                />
              ) : null}
              <span className="flex-1">
                {item.quantity} × {item.product_title}
                {item.variant_title ? ` (${item.variant_title})` : ""}
              </span>
              <span>{money(item.line_total, store)}</span>
            </li>
          ))}
        </ul>
        <Totals cart={{ ...order, shippingKnown: true }} store={store} />
      </section>

      {order.shipping_address ? (
        <section aria-labelledby="envio" className="space-y-1 text-sm">
          <h2 id="envio" className="font-semibold">
            Envío
          </h2>
          {order.shipping ? (
            <p>
              {order.shipping.name}
              {arrival ? (
                <>
                  {" · "}
                  <strong>{arrival} (estimado)</strong>
                </>
              ) : null}
            </p>
          ) : null}
          <p>{order.shipping_address.recipient_name}</p>
          <p>
            {order.shipping_address.line1}
            {order.shipping_address.line2 ? `, ${order.shipping_address.line2}` : ""}
          </p>
          <p>
            {order.shipping_address.postal_code} {order.shipping_address.city},{" "}
            {order.shipping_address.region}, {order.shipping_address.country}
          </p>
        </section>
      ) : null}
      {reviewables.length > 0 ? (
        <section
          aria-labelledby="opinar"
          className="space-y-4 border-t border-[var(--sf-border)] pt-5"
        >
          <h2 id="opinar" className="font-semibold">
            ¿Qué te pareció tu compra?
          </h2>
          <p className="text-sm text-[var(--sf-muted)]">
            Tu opinión ayuda a otros clientes. Se publica con tu nombre y la inicial de tu apellido,
            después de que la tienda la revise.
          </p>
          <ul className="space-y-6">
            {reviewables.map((r) => (
              <li key={r.product_id} className="space-y-2">
                <h3 className="text-sm font-semibold">{r.title}</h3>
                {r.reviewed ? (
                  <p className="text-sm">Ya enviaste tu opinión de este producto. ¡Gracias!</p>
                ) : (
                  <ReviewForm
                    storeId={store.id}
                    orderId={order.id}
                    token={t}
                    productId={r.product_id}
                    title={r.title}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="border-t border-[var(--sf-border)] pt-5">
        <Link
          href="/productos"
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          Seguir comprando
        </Link>
      </p>
    </section>
  );
}
