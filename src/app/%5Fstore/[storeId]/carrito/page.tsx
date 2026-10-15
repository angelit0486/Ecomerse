import type { Metadata } from "next";
import Link from "next/link";

import { freeShippingProgress } from "@/lib/catalog/merchandising";
import { getCart, getCartLegends } from "@/server/storefront/cart";
import { getShippingPromo, mediaUrl, type ShippingPromo } from "@/server/storefront/catalog";
import type { StorePublic } from "@/server/storefront/store-public";
import { getStorefront } from "@/server/storefront/context";

import { money } from "../_components/format";
import { PurchaseLegends } from "../_components/supplement-info";
import { Totals } from "../_components/totals";
import { DiscountForm, LineForm } from "./cart-forms";

export const metadata: Metadata = { title: "Carrito", robots: { index: false, follow: false } };

type Props = { params: Promise<{ storeId: string }> };

const STATE_NOTES = {
  unavailable: "Ya no está disponible: quítalo para continuar.",
  insufficient_stock: "No hay suficientes existencias para esta cantidad.",
} as const;

export default async function CartPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const [cart, legends, promo] = await Promise.all([
    getCart(store.id),
    getCartLegends(store.id, "cart"),
    getShippingPromo(store.id),
  ]);

  if (!cart || cart.lines.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        <p>Tu carrito está vacío.</p>
        <Link href="/productos" className="underline">
          Ver productos
        </Link>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 gap-8 md:grid-cols-[2fr_1fr]">
      {/* min-w-0: un nombre largo no ensancha la columna en móvil (sin scroll horizontal). */}
      <div className="min-w-0 space-y-4">
        <h1 className="text-2xl font-semibold">Tu carrito</h1>
        {promo && cart.requires_shipping ? (
          <FreeShippingBar
            promo={promo}
            subtotal={cart.subtotal}
            discountTotal={cart.discount_total}
            store={store}
          />
        ) : null}
        <ul className="divide-y divide-[var(--sf-border)]" aria-label="Productos en el carrito">
          {cart.lines.map((line) => (
            <li key={line.variant_id} className="flex gap-4 py-4">
              {line.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                <img
                  src={mediaUrl(line.image.path)}
                  alt=""
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded object-cover"
                />
              ) : (
                <div className="h-20 w-20 rounded bg-[var(--sf-surface)]" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex justify-between gap-4">
                  <div>
                    <Link
                      href={`/productos/${line.product_slug}`}
                      className="font-medium hover:underline"
                    >
                      {line.product_title}
                    </Link>
                    {line.variant_title ? (
                      <p className="text-sm text-[var(--sf-muted)]">{line.variant_title}</p>
                    ) : null}
                    <p className="text-sm">{money(line.unit_price, store)} c/u</p>
                  </div>
                  <p className="font-medium">
                    {money(line.line_subtotal ?? line.unit_price * line.quantity, store)}
                  </p>
                </div>
                {line.state !== "ok" ? (
                  <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
                    {STATE_NOTES[line.state]}
                  </p>
                ) : null}
                <LineForm
                  storeId={store.id}
                  variantId={line.variant_id}
                  title={line.product_title}
                  quantity={line.quantity}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <aside
        aria-label="Resumen"
        className="space-y-5 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5"
      >
        <DiscountForm storeId={store.id} code={cart.discount_code} />
        <Totals
          cart={{
            ...cart,
            shippingKnown: cart.shipping.status === "ok" || cart.shipping.status === "not_required",
          }}
          store={store}
        />
        <PurchaseLegends legends={legends} />
        {cart.has_unavailable ? (
          <p className="text-sm">Quita los productos no disponibles para continuar.</p>
        ) : (
          <Link
            href="/checkout"
            className="flex h-11 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] font-medium text-[var(--sf-btn-fg)]"
          >
            Continuar al pago
          </Link>
        )}
      </aside>
    </section>
  );
}

/**
 * «Te faltan $X para el envío gratis» (F9-T04): sale de la regla `free_over`
 * real de la tienda y del subtotal descontado del carrito; sin regla no se
 * muestra. Informativa: el envío lo calcula la base en el pago.
 */
function FreeShippingBar({
  promo,
  subtotal,
  discountTotal,
  store,
}: {
  promo: ShippingPromo;
  subtotal: number;
  discountTotal: number;
  store: StorePublic;
}) {
  const progress = freeShippingProgress(subtotal, discountTotal, promo.free_over);
  if (!progress) return null;
  const where = promo.conditional ? " (según destino)" : "";
  return (
    <div className="space-y-2 rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] p-4 text-sm">
      <p id="sf-envio-gratis" className="font-medium">
        {progress.reached
          ? `Tu pedido tiene envío gratis${where}.`
          : `Te faltan ${money(progress.remaining, store)} para el envío gratis${where}.`}
      </p>
      {/* <progress> nativo: sin atributo style (la CSP no permite estilos en línea). */}
      <progress
        aria-labelledby="sf-envio-gratis"
        max={100}
        value={progress.percent}
        className="block h-2 w-full appearance-none overflow-hidden rounded-full [&::-moz-progress-bar]:bg-[var(--sf-btn-bg)] [&::-webkit-progress-bar]:bg-[var(--sf-bg)] [&::-webkit-progress-value]:bg-[var(--sf-btn-bg)]"
      />
    </div>
  );
}
