import type { PaymentMethod } from "@/lib/theme/constants";

/** Pasarela cobrable → insignia del pie que la representa sin suponer de más. */
const PROVIDER_BADGE: Partial<Record<string, PaymentMethod>> = {
  mercadopago: "mercado_pago",
};

/**
 * Insignias del pie: las que la tienda eligió en Apariencia más las de las
 * pasarelas que de verdad tiene activas (auditoría UX: el pie no debe callar
 * cómo se paga). No se deducen marcas de tarjeta ni OXXO: eso depende de la
 * configuración de la cuenta de la pasarela, que aquí no se conoce.
 */
export function paymentBadges(
  chosen: readonly PaymentMethod[],
  providers: readonly string[],
): PaymentMethod[] {
  const derived = providers.flatMap((p) => {
    const badge = PROVIDER_BADGE[p];
    return badge ? [badge] : [];
  });
  return [...new Set([...chosen, ...derived])];
}
