import { formatMoney } from "@/lib/money/format";
import type { Availability } from "@/server/storefront/catalog";

/** Textos del storefront (español; el comprador nunca ve cantidades, §21.3). */
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  in_stock: "Disponible",
  low_stock: "Últimas piezas",
  backorder: "Bajo pedido",
  out_of_stock: "Agotado",
};

export function money(cents: number, store: { currency: string; locale: string }): string {
  return formatMoney(cents, store.currency, store.locale);
}
