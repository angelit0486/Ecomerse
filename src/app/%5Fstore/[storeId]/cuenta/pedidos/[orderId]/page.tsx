import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { visibleStatus } from "@/lib/orders/visible-status";
import { accountOrder } from "@/server/storefront/account";
import { getStorefront } from "@/server/storefront/context";
import { accountReviewables } from "@/server/storefront/reviews";

import { money } from "../../../_components/format";
import { Totals } from "../../../_components/totals";
import { OrderReviews } from "../../../pedido/[orderId]/order-reviews";
import { sendAccountReview } from "../../../pedido/[orderId]/review-actions";

export const metadata: Metadata = { title: "Tu pedido", robots: { index: false, follow: false } };

type Props = { params: Promise<{ storeId: string; orderId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pedido de la cuenta: solo el comprador dueño (otra cuenta o tienda → 404 uniforme). */
export default async function AccountOrderPage({ params }: Props) {
  const { storeId, orderId } = await params;
  const { store } = await getStorefront(storeId);
  if (!UUID_RE.test(orderId)) notFound();
  const order = await accountOrder(store.id, orderId);
  if (!order) notFound();
  const reviewables = await accountReviewables(store.id, order.id);

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1">
        <Link href="/cuenta" className="text-sm underline">
          ← Mi cuenta
        </Link>
        <h1 className="text-2xl font-semibold">Pedido {order.display_number}</h1>
        <p role="status">
          Estado: <strong>{visibleStatus(order)}</strong>
        </p>
      </header>

      {order.shipments.length > 0 ? (
        <section aria-labelledby="envios" className="space-y-2 text-sm">
          <h2 id="envios" className="font-semibold">
            Envíos
          </h2>
          <ul className="space-y-1">
            {order.shipments.map((s, i) => (
              <li key={i}>
                {s.status === "delivered" ? "Entregado" : "En camino"}
                {s.carrier ? ` · ${s.carrier}` : ""}
                {s.tracking_number ? ` · Guía ${s.tracking_number}` : ""}
                {s.tracking_url?.startsWith("https://") ? (
                  <>
                    {" · "}
                    <a
                      href={s.tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Rastrear
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="productos" className="space-y-3">
        <h2 id="productos" className="font-semibold">
          Productos
        </h2>
        <ul className="divide-y divide-[var(--sf-border)]">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4 py-3 text-sm">
              <span>
                {item.quantity} × {item.product_title}
                {item.variant_title ? ` (${item.variant_title})` : ""}
              </span>
              <span>{money(item.line_total, store)}</span>
            </li>
          ))}
        </ul>
        <Totals cart={{ ...order, shippingKnown: true }} store={store} />
      </section>
      <OrderReviews
        reviewables={reviewables}
        actionFor={(productId) => sendAccountReview.bind(null, store.id, order.id, productId)}
      />
    </section>
  );
}
