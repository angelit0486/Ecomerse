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

function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["es-MX"], { type: "region" }).of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Lo que sigue a «Envío gratis» en la tienda (franja de confianza y ficha). Una
 * tienda que envía gratis siempre guarda su regla con mínimo $0: no se dice
 * «desde $0.00» sino «a todo México» (o «según destino» si no llega a todo el país).
 */
export function freeShippingReach(
  promo: ShippingPromoLike,
  format: (cents: number) => string,
  country: string | null | undefined,
): string {
  if (promo.free_over === 0) {
    const name = countryName(country);
    if (promo.conditional) return "según destino";
    return name ? `a todo ${name}` : "en todos los pedidos";
  }
  return `desde ${format(promo.free_over)}${promo.conditional ? " (según destino)" : ""}`;
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
  if (promo.conditional)
    return promo.free_over === 0
      ? "Gratis según tu dirección"
      : `Según tu dirección (gratis desde ${format(promo.free_over)})`;
  if (reached || promo.price === 0) return "Gratis";
  return `${format(promo.price)} (gratis desde ${format(promo.free_over)})`;
}

/**
 * Sin ninguna forma de envío para una dirección válida (interruptor
 * `checkout_shipping_messages`): dice qué falta en vez de pedir «elegir» algo
 * que no existe. Causa más común: la tienda no tiene tarifas activas para ese
 * estado (docs/plan/DIAGNOSTICO-ENVIO.md).
 */
export function noShippingMessage(address: { region?: string | null } | null | undefined): string {
  const region = address?.region?.trim();
  return region
    ? `Esta tienda todavía no hace envíos a ${region}. Revisa el estado de tu dirección o escríbele a la tienda.`
    : "Esta tienda todavía no hace envíos a esta dirección. Revísala o escríbele a la tienda.";
}

/** Con una sola forma de envío disponible, esa se marca sola. */
export function singleRateId(options: readonly { rate_id: string }[]): string | null {
  return options.length === 1 ? options[0]!.rate_id : null;
}
