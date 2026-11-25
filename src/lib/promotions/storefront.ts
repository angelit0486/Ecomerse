import { formatMoney } from "@/lib/money/format";

import { describePromotion, promotionRules, type PromotionRules } from "./rules";

/**
 * Promociones en la tienda pública (ADR-070, fase 3). Solo describen: el ahorro
 * real lo calcula la base en el carrito (`app.calculate_cart`) y el navegador
 * nunca lo calcula ni lo manda.
 */
export interface StorefrontPromotion {
  id: string;
  /** Leyenda que la dueña escribió para el comprador (máx. 40). */
  label: string;
  type: string;
  rules: unknown;
}

export type ProductPromotions = Record<string, StorefrontPromotion[]>;

/** La regla validada; null si la base mandó algo que este código no entiende. */
export function promotionRule(
  p: Pick<StorefrontPromotion, "type" | "rules">,
): PromotionRules | null {
  const parsed = promotionRules.safeParse({ type: p.type, rules: p.rules });
  return parsed.success ? parsed.data : null;
}

const pct = (bps: number) =>
  `${(bps / 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;

/** Insignia corta para la tarjeta: «Lleva 3, paga 2», «2a al 50%», «Mayoreo desde 6 pzas». */
export function promotionBadge(p: Pick<StorefrontPromotion, "type" | "rules">): string | null {
  const r = promotionRule(p);
  if (!r) return null;
  switch (r.type) {
    case "buy_n_pay_m":
      return `Lleva ${r.rules.buy}, paga ${r.rules.pay}`;
    case "nth_percent":
      return r.rules.percent_bps === 10000
        ? `${r.rules.nth}a gratis`
        : `${r.rules.nth}a al ${pct(r.rules.percent_bps)}`;
    case "volume":
      return `Mayoreo desde ${r.rules.tiers[0]!.min_qty} pzas`;
  }
}

export interface PromotionDetail {
  id: string;
  label: string;
  /** «Lleva 3, paga 2», «La segunda al 50% de descuento»… */
  summary: string;
  /** Mayoreo: un renglón por escalón («6 piezas o más: $150.00 c/u»). */
  tiers: string[];
}

/** Lo que la ficha del producto explica de cada promoción (las inválidas se omiten). */
export function promotionDetails(
  list: StorefrontPromotion[] | undefined,
  currency = "MXN",
): PromotionDetail[] {
  const out: PromotionDetail[] = [];
  for (const p of list ?? []) {
    const r = promotionRule(p);
    if (!r) continue;
    const tiers =
      r.type === "volume"
        ? r.rules.tiers.map(
            (t) =>
              `${t.min_qty} piezas o más: ${
                r.rules.mode === "unit_price"
                  ? `${formatMoney(t.value, currency)} c/u`
                  : `${pct(t.value)} de descuento`
              }`,
          )
        : [];
    out.push({
      id: p.id,
      label: p.label,
      summary: r.type === "volume" ? "Precio de mayoreo" : describePromotion(r, currency),
      tiers,
    });
  }
  return out;
}

/** Ahorro por promociones de una línea del carrito o del pedido (lo que calculó la base). */
export function linePromotionSavings(line: { promotion_allocation?: number | null }): number {
  const v = line.promotion_allocation ?? 0;
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

/** Lo que la base dice de una línea del carrito: [{promotion_id, units, amount}]. */
export interface LinePromotion {
  promotion_id: string;
  units: number;
  amount: number;
}

/** Promociones aplicadas al carrito completo (para nombrar las de cada línea). */
export interface AppliedPromotion {
  promotion_id: string;
  label: string;
  amount: number;
}

/**
 * «3×2 en playeras: −$100.00» de una línea del carrito: la leyenda sale de las
 * promociones aplicadas al carrito y el monto, de la línea (calculado por la base).
 */
export function cartLinePromotionNotes(
  line: { promotions?: LinePromotion[] | null },
  applied: AppliedPromotion[] | null | undefined,
): { label: string; amount: number }[] {
  const labels = new Map((applied ?? []).map((p) => [p.promotion_id, p.label]));
  return (line.promotions ?? [])
    .filter((p) => Number.isSafeInteger(p.amount) && p.amount > 0)
    .map((p) => ({ label: labels.get(p.promotion_id) ?? "Promoción", amount: p.amount }));
}
