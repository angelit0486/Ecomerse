/**
 * Elección de la tarifa que se preselecciona al cotizar (F9-T03, Gate F9): el
 * costo efectivo para este carrito, con la misma regla que `app.calculate_cart`
 * (§17.3.4): `free_over` es gratis si el subtotal ya descontado alcanza el
 * umbral; recoger en tienda solo si no hay envío a domicilio. Es solo una
 * preselección: el total lo calcula siempre la base.
 */
export interface RateOption {
  rate_id: string;
  type: "flat" | "free_over" | "pickup";
  price: number;
  free_over_subtotal: number | null;
}

export function effectiveShippingPrice(
  option: RateOption,
  cart: { subtotal: number; discount_total: number },
): number {
  if (option.type === "pickup") return 0;
  if (
    option.type === "free_over" &&
    option.free_over_subtotal !== null &&
    cart.subtotal - cart.discount_total >= option.free_over_subtotal
  ) {
    return 0;
  }
  return option.price;
}

export function preferredRate<T extends RateOption>(
  options: readonly T[],
  cart: { subtotal: number; discount_total: number },
): T | undefined {
  return [...options].sort(
    (a, b) =>
      Number(a.type === "pickup") - Number(b.type === "pickup") ||
      effectiveShippingPrice(a, cart) - effectiveShippingPrice(b, cart),
  )[0];
}

/** Promoción de envío de la tienda (`storefront.shipping_promo`). */
export interface ShippingPromoLike {
  free_over: number;
  conditional: boolean;
  price: number;
}

/**
 * Texto del envío antes de tener dirección (carrito y checkout): así el comprador
 * ve el costo desde el principio y el total no «sube» al confirmar. Es solo una
 * referencia: el envío real lo calcula la base con la dirección.
 */
export function shippingEstimate(
  promo: ShippingPromoLike | null,
  cart: { subtotal: number; discount_total: number },
  format: (cents: number) => string,
): string | undefined {
  if (!promo) return undefined;
  const reached = cart.subtotal - cart.discount_total >= promo.free_over;
  if (promo.conditional) return `Según tu dirección (gratis desde ${format(promo.free_over)})`;
  if (reached || promo.price === 0) return "Gratis";
  return `${format(promo.price)} (gratis desde ${format(promo.free_over)})`;
}
