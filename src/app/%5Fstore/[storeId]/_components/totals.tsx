import type { CartView } from "@/server/storefront/cart";

import { money } from "./format";

/**
 * Resumen de totales calculados por la base (el navegador nunca los calcula).
 * `discount_total` incluye las promociones automáticas (ADR-070): se muestran
 * aparte («Promociones») y el resto es el cupón («Descuento»).
 */
export function Totals({
  cart,
  store,
  shippingNote,
}: {
  cart: Pick<
    CartView,
    "subtotal" | "discount_total" | "shipping_total" | "tax_total" | "total" | "prices_include_tax"
  > & {
    shippingKnown: boolean;
    promotion_total?: number | null | undefined;
    /** Detalle por promoción (carrito: aplicadas; pedido: su copia). */
    promotions?: { label: string; amount: number }[] | null | undefined;
  };
  store: { currency: string; locale: string };
  /** Envío estimado antes de la dirección (p. ej. «$99.00 (gratis desde $999.00)»). */
  shippingNote?: string | undefined;
}) {
  const promotionTotal = Math.max(0, Math.min(cart.promotion_total ?? 0, cart.discount_total));
  const couponTotal = cart.discount_total - promotionTotal;
  const promotions = (cart.promotions ?? []).filter((p) => p.amount > 0);
  // Una fila por promoción si la base manda el detalle y cuadra; si no, una sola.
  const rows =
    promotions.length > 0 && promotions.reduce((n, p) => n + p.amount, 0) === promotionTotal
      ? promotions.map((p) => ({ label: `Promoción: ${p.label}`, amount: p.amount }))
      : promotionTotal > 0
        ? [{ label: "Promociones", amount: promotionTotal }]
        : [];
  return (
    <div className="space-y-1">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{money(cart.subtotal, store)}</dd>
        </div>
        {rows.map((r, i) => (
          <div
            key={`${r.label}-${i}`}
            className="flex justify-between gap-3 font-semibold text-[var(--sf-sale-text)]"
          >
            <dt>{r.label}</dt>
            <dd className="shrink-0">−{money(r.amount, store)}</dd>
          </div>
        ))}
        {couponTotal > 0 ? (
          <div className="flex justify-between">
            <dt>Descuento</dt>
            <dd>−{money(couponTotal, store)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between">
          <dt>Envío</dt>
          <dd>
            {!cart.shippingKnown
              ? (shippingNote ?? "Se calcula con tu dirección")
              : cart.shipping_total === 0
                ? "Gratis"
                : money(cart.shipping_total, store)}
          </dd>
        </div>
        {cart.tax_total > 0 ? (
          <div className="flex justify-between text-[var(--sf-muted)]">
            <dt>{cart.prices_include_tax ? "Impuestos incluidos" : "Impuestos"}</dt>
            <dd>{money(cart.tax_total, store)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-[var(--sf-border)] pt-2 text-base font-semibold">
          {/* Sin dirección el total aún no lleva envío: decirlo evita la «sorpresa» al pagar. */}
          <dt>{cart.shippingKnown ? "Total" : "Total sin envío"}</dt>
          <dd>{money(cart.total, store)}</dd>
        </div>
      </dl>
      {promotionTotal > 0 ? (
        <p className="text-right text-xs font-semibold text-[var(--sf-sale-text)]">
          Ahorras {money(cart.discount_total, store)}
        </p>
      ) : null}
    </div>
  );
}
