import { z } from "zod";

import { formatMoney } from "@/lib/money/format";

/**
 * Promociones automáticas (ADR-070): reglas por tipo, espejo exacto de
 * `app.promotion_rules_valid` (20261125000100_promotions.sql). La base es la
 * autoridad: esto solo sirve para validar formularios y describir la promoción
 * en español antes de mandarla. Dinero en centavos; porcentajes en puntos base.
 */
export const PROMOTION_TYPES = ["volume", "buy_n_pay_m", "nth_percent"] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const tier = z.strictObject({ min_qty: int(2, 999), value: int(1, 999_999_999_999) });

export const volumeRules = z
  .strictObject({ mode: z.enum(["unit_price", "percent"]), tiers: z.array(tier).min(1).max(5) })
  .superRefine((r, ctx) => {
    r.tiers.forEach((t, i) => {
      if (r.mode === "percent" && t.value > 9999) {
        ctx.addIssue({ code: "custom", path: ["tiers", i, "value"], message: "Máximo 99.99%." });
      }
      const prev = r.tiers[i - 1];
      if (!prev) return;
      if (t.min_qty <= prev.min_qty) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "min_qty"],
          message: "Cada escalón pide más piezas que el anterior.",
        });
      }
      if (r.mode === "unit_price" ? t.value >= prev.value : t.value <= prev.value) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "value"],
          message: "Cada escalón debe dar mejor precio que el anterior.",
        });
      }
    });
  });

export const buyNPayMRules = z
  .strictObject({ buy: int(2, 20), pay: int(1, 19) })
  .refine((r) => r.pay < r.buy, {
    path: ["pay"],
    message: "Debe pagar menos piezas de las que lleva.",
  });

export const nthPercentRules = z.strictObject({ nth: int(2, 20), percent_bps: int(1, 10000) });

export const promotionRules = z.discriminatedUnion("type", [
  z.object({ type: z.literal("volume"), rules: volumeRules }),
  z.object({ type: z.literal("buy_n_pay_m"), rules: buyNPayMRules }),
  z.object({ type: z.literal("nth_percent"), rules: nthPercentRules }),
]);
export type PromotionRules = z.infer<typeof promotionRules>;

/** ¿La base aceptaría estas reglas? (misma respuesta que app.promotion_rules_valid). */
export function rulesValid(type: unknown, rules: unknown): boolean {
  return promotionRules.safeParse({ type, rules }).success;
}

const pct = (bps: number) =>
  `${(bps / 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`;
const NTH: Record<number, string> = {
  2: "La segunda",
  3: "La tercera",
  4: "La cuarta",
  5: "La quinta",
};

/** Descripción corta para el comprador y el panel: «Lleva 3, paga 2», «La segunda al 50%»… */
export function describePromotion(p: PromotionRules, currency = "MXN"): string {
  switch (p.type) {
    case "buy_n_pay_m":
      return `Lleva ${p.rules.buy}, paga ${p.rules.pay}`;
    case "nth_percent": {
      const what =
        p.rules.percent_bps === 10000 ? "gratis" : `al ${pct(p.rules.percent_bps)} de descuento`;
      return `${NTH[p.rules.nth] ?? `La pieza ${p.rules.nth}`} ${what}`;
    }
    case "volume":
      return p.rules.tiers
        .map((t) =>
          p.rules.mode === "unit_price"
            ? `Desde ${t.min_qty}: ${formatMoney(t.value, currency)} c/u`
            : `Desde ${t.min_qty}: ${pct(t.value)} de descuento`,
        )
        .join(" · ");
  }
}
