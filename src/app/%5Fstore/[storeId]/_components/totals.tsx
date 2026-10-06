import type { CartView } from "@/server/storefront/cart";

import { money } from "./format";

/** Resumen de totales calculados por la base (el navegador nunca los calcula). */
export function Totals({
  cart,
  store,
}: {
  cart: Pick<
    CartView,
    "subtotal" | "discount_total" | "shipping_total" | "tax_total" | "total" | "prices_include_tax"
  > & {
    shippingKnown: boolean;
  };
  store: { currency: string; locale: string };
}) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt>Subtotal</dt>
        <dd>{money(cart.subtotal, store)}</dd>
      </div>
      {cart.discount_total > 0 ? (
        <div className="flex justify-between">
          <dt>Descuento</dt>
          <dd>−{money(cart.discount_total, store)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between">
        <dt>Envío</dt>
        <dd>
          {cart.shippingKnown ? money(cart.shipping_total, store) : "Se calcula con tu dirección"}
        </dd>
      </div>
      {cart.tax_total > 0 ? (
        <div className="flex justify-between text-[var(--sf-muted)]">
          <dt>{cart.prices_include_tax ? "Impuestos incluidos" : "Impuestos"}</dt>
          <dd>{money(cart.tax_total, store)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-[var(--sf-border)] pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd>{money(cart.total, store)}</dd>
      </div>
    </dl>
  );
}
