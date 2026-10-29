import { z } from "zod";

/**
 * Resumen de lo que cambia una importación (misión vendible F3): lo calcula
 * `public.import_preview_changes` antes de confirmar. Con cientos de productos,
 * «1000 por actualizar» no dice si el archivo sube precios o reemplaza existencias.
 */
const example = z.object({
  title: z.string(),
  sku: z.string().nullable(),
  from: z.number().int().nullable(),
  to: z.number().int(),
});

export const previewChangesSchema = z.object({
  price_changes: z.number().int().nonnegative(),
  price_up: z.number().int().nonnegative(),
  price_down: z.number().int().nonnegative(),
  price_examples: z.array(example),
  stock_visible: z.boolean(),
  stock_changes: z.number().int().nonnegative().nullable(),
  stock_examples: z.array(example).nullable(),
  unmatched_variants: z.number().int().nonnegative(),
  status_changes: z.number().int().nonnegative().nullable(),
});

export type PreviewChanges = z.infer<typeof previewChangesSchema>;
export type ChangeExample = z.infer<typeof example>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Frase de precios: «12 precios cambian: 10 suben y 2 bajan». */
export function priceSummary(c: PreviewChanges): string {
  if (c.price_changes === 0) return "Ningún precio cambia.";
  const parts = [
    c.price_up > 0 ? `${c.price_up} ${c.price_up === 1 ? "sube" : "suben"}` : null,
    c.price_down > 0 ? `${c.price_down} ${c.price_down === 1 ? "baja" : "bajan"}` : null,
  ].filter(Boolean);
  return `${plural(c.price_changes, "precio cambia", "precios cambian")}: ${parts.join(" y ")}.`;
}

/** Frase de existencias; null si quien mira no puede ver el inventario. */
export function stockSummary(c: PreviewChanges): string | null {
  if (!c.stock_visible || c.stock_changes === null) return null;
  if (c.stock_changes === 0) return "Ninguna existencia cambia.";
  return `${plural(c.stock_changes, "presentación cambia", "presentaciones cambian")} de existencias.`;
}

/** Variación porcentual redondeada («+10 %», «−3 %»); null sin precio de hoy. */
export function percentChange(from: number | null, to: number): string | null {
  if (from === null || from <= 0) return null;
  const pct = Math.round(((to - from) / from) * 100);
  if (pct === 0) return to > from ? "+<1 %" : "−<1 %";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}
