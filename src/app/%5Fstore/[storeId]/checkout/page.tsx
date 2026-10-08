import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCart, getCartLegends, paymentMethods } from "@/server/storefront/cart";
import { newCheckoutKey } from "@/server/storefront/checkout";
import { getStorefront } from "@/server/storefront/context";

import { money } from "../_components/format";
import { PurchaseLegends } from "../_components/supplement-info";
import { Totals } from "../_components/totals";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Pago", robots: { index: false, follow: false } };

type Props = { params: Promise<{ storeId: string }> };

/** Checkout de una página (§17): todo lo calcula la base en cada render. */
export default async function CheckoutPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const [cart, methods, legends] = await Promise.all([
    getCart(store.id),
    paymentMethods(store.id),
    getCartLegends(store.id, "checkout"),
  ]);
  if (!cart || cart.item_count === 0) redirect("/carrito");

  const labels = Object.fromEntries(
    cart.shipping_options.map((o) => [
      o.rate_id,
      o.type === "pickup"
        ? "Gratis"
        : o.type === "free_over" && o.free_over_subtotal != null
          ? `${money(o.price, store)} (gratis desde ${money(o.free_over_subtotal, store)})`
          : money(o.price, store),
    ]),
  );

  return (
    <section className="grid gap-10 md:grid-cols-[3fr_2fr]">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Pago</h1>
        {cart.has_unavailable ? (
          <p role="alert">
            Hay productos no disponibles en tu carrito.{" "}
            <Link href="/carrito" className="underline">
              Revisa el carrito
            </Link>
            .
          </p>
        ) : null}
        <CheckoutForm
          storeId={store.id}
          storeCountry={store.country}
          cart={cart}
          methods={methods}
          idempotencyKey={newCheckoutKey()}
          shippingLabels={labels}
        />
      </div>
      <aside
        aria-label="Resumen del pedido"
        className="h-fit space-y-4 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5"
      >
        <h2 className="font-semibold">Resumen</h2>
        <ul className="space-y-2 text-sm">
          {cart.lines.map((l) => (
            <li key={l.variant_id} className="flex justify-between gap-4">
              <span>
                {l.quantity} × {l.product_title}
                {l.variant_title ? ` (${l.variant_title})` : ""}
              </span>
              <span>{money(l.line_subtotal ?? l.unit_price * l.quantity, store)}</span>
            </li>
          ))}
        </ul>
        {cart.discount?.status === "ok" ? (
          <p className="text-sm">Código {cart.discount.code} aplicado.</p>
        ) : null}
        <Totals
          cart={{
            ...cart,
            shippingKnown: cart.shipping.status === "ok" || cart.shipping.status === "not_required",
          }}
          store={store}
        />
        <PurchaseLegends legends={legends} />
        <Link href="/carrito" className="text-sm underline">
          Modificar el carrito
        </Link>
      </aside>
    </section>
  );
}
