import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { effectiveShippingPrice, shippingEstimate } from "@/lib/checkout/shipping";
import { getCart, getCartLegends, paymentMethods } from "@/server/storefront/cart";
import { getPolicyLinks, getShippingPromo } from "@/server/storefront/catalog";
import { newCheckoutKey } from "@/server/storefront/checkout";
import { getStorefront } from "@/server/storefront/context";

import { money } from "../_components/format";
import { PurchaseLegends } from "../_components/supplement-info";
import { Totals } from "../_components/totals";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = {
  title: "Finalizar compra",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ storeId: string }> };

/** Checkout de una página (§17): todo lo calcula la base en cada render. */
export default async function CheckoutPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const [cart, methods, legends, promo, policies] = await Promise.all([
    getCart(store.id),
    paymentMethods(store.id),
    getCartLegends(store.id, "checkout"),
    getShippingPromo(store.id),
    getPolicyLinks(store.id),
  ]);
  if (!cart || cart.item_count === 0) redirect("/carrito");

  // El costo que tendrá cada opción para este carrito (Gate F9): «Gratis» si ya
  // alcanzó el envío gratis, en lugar de un precio que luego no se cobra.
  const labels = Object.fromEntries(
    cart.shipping_options.map((o) => {
      const cost = effectiveShippingPrice(o, cart);
      return [
        o.rate_id,
        cost === 0
          ? o.price > 0
            ? `Gratis (antes ${money(o.price, store)})`
            : "Gratis"
          : o.type === "free_over" && o.free_over_subtotal != null
            ? `${money(cost, store)} (gratis desde ${money(o.free_over_subtotal, store)})`
            : money(cost, store),
      ];
    }),
  );
  const itemCount = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const totalLabel =
    cart.shipping.status === "ok" || cart.shipping.status === "not_required"
      ? money(cart.total, store)
      : `${money(cart.total, store)} + envío`;
  const summaryLines = (
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
  );

  return (
    <section className="grid grid-cols-1 gap-10 md:grid-cols-[3fr_2fr]">
      <div className="min-w-0 space-y-6">
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          Finalizar compra
        </h1>
        {/* Móvil: el resumen y el total arriba del formulario, plegables (Gate F9). */}
        <details className="rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-4 md:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-medium">
            <span>
              Ver resumen ({itemCount} {itemCount === 1 ? "producto" : "productos"})
            </span>
            <span className="shrink-0">{totalLabel}</span>
          </summary>
          <div className="mt-3 space-y-3">{summaryLines}</div>
        </details>
        {cart.has_unavailable ? (
          <p role="alert">
            Hay productos no disponibles en tu carrito.{" "}
            <Link prefetch={false} href="/carrito" className="underline">
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
          totalLabel={totalLabel}
        />
        {/* Las políticas publicadas, junto al botón de pago (auditoría REG-07). */}
        {policies.length > 0 ? (
          <nav aria-label="Políticas de la tienda" className="text-sm text-[var(--sf-muted)]">
            <p>Antes de pagar puedes revisar:</p>
            <ul className="flex flex-wrap gap-x-4">
              {policies.map((p) => (
                <li key={p.href}>
                  <Link
                    prefetch={false}
                    href={p.href}
                    className="inline-flex min-h-11 items-center underline underline-offset-2"
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
      <aside
        aria-label="Resumen del pedido"
        className="h-fit space-y-4 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5 md:sticky md:top-36 md:max-h-[calc(100dvh-10rem)] md:self-start md:overflow-y-auto"
      >
        <h2 className="font-semibold">Resumen</h2>
        {summaryLines}
        {cart.discount?.status === "ok" ? (
          <p className="text-sm">Código {cart.discount.code} aplicado.</p>
        ) : null}
        <Totals
          cart={{
            ...cart,
            shippingKnown: cart.shipping.status === "ok" || cart.shipping.status === "not_required",
          }}
          store={store}
          shippingNote={shippingEstimate(promo, cart, (c) => money(c, store))}
        />
        <PurchaseLegends legends={legends} />
        <Link
          prefetch={false}
          href="/carrito"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Modificar el carrito
        </Link>
      </aside>
    </section>
  );
}
