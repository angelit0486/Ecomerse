import { centsToInput, formatMoney, parseMoneyToCents } from "@/lib/money/format";

import { promotionRules, type PromotionRules, type PromotionType } from "./rules";

/**
 * Formulario de promociones del panel (fase 2, ADR-070): texto del formulario ⇄
 * payload de `promotions_upsert`. Puro (sin servidor) para probarlo solo. La base
 * vuelve a validar todo; esto solo da mensajes claros antes de mandarlo.
 */
export const MAX_TIERS = 5;
export const SCOPES = ["store", "categories", "products"] as const;
export type PromotionScope = (typeof SCOPES)[number];

export interface PromotionFormValues {
  id: string;
  name: string;
  label: string;
  type: PromotionType;
  buy: string;
  pay: string;
  nth: string;
  nth_percent: string;
  volume_mode: "unit_price" | "percent";
  tiers: { qty: string; value: string }[];
  scope: PromotionScope;
  product_ids: string[];
  category_ids: string[];
  applies_to_sale_items: boolean;
  starts_at: string;
  ends_at: string;
}

export const EMPTY_PROMOTION: PromotionFormValues = {
  id: "",
  name: "",
  label: "",
  type: "buy_n_pay_m",
  buy: "3",
  pay: "2",
  nth: "2",
  nth_percent: "50",
  volume_mode: "unit_price",
  tiers: [{ qty: "", value: "" }],
  scope: "store",
  product_ids: [],
  category_ids: [],
  applies_to_sale_items: false,
  starts_at: "",
  ends_at: "",
};

export const FIELD_MESSAGES = {
  name: "Escribe un nombre de 1 a 80 letras (solo lo ves tú).",
  label: "Escribe lo que verá el cliente, de 1 a 40 letras (por ejemplo «3×2 en playeras»).",
  type: "Elige un tipo de promoción.",
  buy: "Lleva: un número de 2 a 20.",
  pay: "Paga: un número menor que «Lleva» (mínimo 1).",
  nth: "La pieza con descuento: un número de 2 a 20.",
  nth_percent: "Descuento: de 0.01 a 100 %.",
  tiers:
    "Revisa los escalones: desde 2 piezas, cada uno con más piezas que el anterior y mejor precio.",
  scope: "Elige a qué aplica.",
  targets: "Elige al menos un producto o categoría (hasta 500).",
  dates: "Revisa las fechas: «Hasta» no puede ser antes de «Desde».",
} as const;
export type PromotionField = keyof typeof FIELD_MESSAGES;

/** "50", "12.5", "7,25" → puntos base (1..max); null si no es válido. */
export function percentToBps(input: string, max = 10000): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps >= 1 && bps <= max ? bps : null;
}

export function bpsToInput(bps: number): string {
  return String(bps / 100);
}

const int = (v: string, min: number, max: number) =>
  /^\d{1,3}$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null;
const day = (v: string) => (v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export interface PromotionPayload {
  id?: string;
  name: string;
  label: string;
  type: PromotionType;
  rules: PromotionRules["rules"];
  scope: PromotionScope;
  product_ids?: string[];
  category_ids?: string[];
  applies_to_sale_items: boolean;
  starts_on: string | null;
  ends_on: string | null;
}

export type ParseResult =
  | { ok: true; payload: PromotionPayload }
  | { ok: false; fields: Partial<Record<PromotionField, string>> };

/** Reglas a partir del formulario; null si no son válidas (con el campo culpable). */
export function rulesFromForm(
  v: PromotionFormValues,
): { rules: PromotionRules } | { field: PromotionField } {
  switch (v.type) {
    case "buy_n_pay_m": {
      const buy = int(v.buy, 2, 20);
      if (buy === null) return { field: "buy" };
      const pay = int(v.pay, 1, 19);
      if (pay === null || pay >= buy) return { field: "pay" };
      return { rules: { type: "buy_n_pay_m", rules: { buy, pay } } };
    }
    case "nth_percent": {
      const nth = int(v.nth, 2, 20);
      if (nth === null) return { field: "nth" };
      const percent_bps = percentToBps(v.nth_percent);
      if (percent_bps === null) return { field: "nth_percent" };
      return { rules: { type: "nth_percent", rules: { nth, percent_bps } } };
    }
    case "volume": {
      const rows = v.tiers.filter((t) => t.qty.trim() !== "" || t.value.trim() !== "");
      if (rows.length === 0 || rows.length > MAX_TIERS) return { field: "tiers" };
      const tiers: { min_qty: number; value: number }[] = [];
      for (const t of rows) {
        const min_qty = int(t.qty, 2, 999);
        const value =
          v.volume_mode === "unit_price" ? parseMoneyToCents(t.value) : percentToBps(t.value, 9999);
        if (min_qty === null || value === null || value < 1) return { field: "tiers" };
        tiers.push({ min_qty, value });
      }
      const parsed = promotionRules.safeParse({
        type: "volume",
        rules: { mode: v.volume_mode, tiers },
      });
      return parsed.success ? { rules: parsed.data } : { field: "tiers" };
    }
    default:
      return { field: "type" };
  }
}

export function parsePromotionForm(v: PromotionFormValues): ParseResult {
  const fields: Partial<Record<PromotionField, string>> = {};
  const name = v.name.trim();
  const label = v.label.trim();
  if (name.length < 1 || name.length > 80) fields.name = FIELD_MESSAGES.name;
  if (label.length < 1 || label.length > 40) fields.label = FIELD_MESSAGES.label;
  const rules = rulesFromForm(v);
  if ("field" in rules) fields[rules.field] = FIELD_MESSAGES[rules.field];
  if (!SCOPES.includes(v.scope)) fields.scope = FIELD_MESSAGES.scope;
  const targets =
    v.scope === "products" ? v.product_ids : v.scope === "categories" ? v.category_ids : [];
  const unique = [...new Set(targets.filter(Boolean))];
  if (v.scope !== "store" && (unique.length < 1 || unique.length > 500)) {
    fields.targets = FIELD_MESSAGES.targets;
  }
  const from = day(v.starts_at);
  const to = day(v.ends_at);
  if (from === undefined || to === undefined || (from && to && to < from)) {
    fields.dates = FIELD_MESSAGES.dates;
  }
  if (Object.keys(fields).length > 0 || "field" in rules) return { ok: false, fields };
  return {
    ok: true,
    payload: {
      ...(v.id ? { id: v.id } : {}),
      name,
      label,
      type: rules.rules.type,
      rules: rules.rules.rules,
      scope: v.scope,
      ...(v.scope === "products" ? { product_ids: unique } : {}),
      ...(v.scope === "categories" ? { category_ids: unique } : {}),
      applies_to_sale_items: v.applies_to_sale_items,
      starts_on: from ?? null,
      ends_on: to ?? null,
    },
  };
}

/** FormData → valores del formulario (los nombres los pone `PromotionForm`). */
export function promotionValuesFromFormData(fd: FormData): PromotionFormValues {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const type = s("type") as PromotionType;
  return {
    id: s("id"),
    name: s("name"),
    label: s("label"),
    type,
    buy: s("buy"),
    pay: s("pay"),
    nth: s("nth"),
    nth_percent: s("nth_percent"),
    volume_mode: s("volume_mode") === "percent" ? "percent" : "unit_price",
    tiers: Array.from({ length: MAX_TIERS }, (_, i) => ({
      qty: s(`tier_qty_${i}`),
      value: s(`tier_value_${i}`),
    })),
    scope: s("scope") as PromotionScope,
    product_ids: fd.getAll("product_ids").map(String),
    category_ids: fd.getAll("category_ids").map(String),
    applies_to_sale_items: fd.get("applies_to_sale_items") === "on",
    starts_at: s("starts_at"),
    ends_at: s("ends_at"),
  };
}

/** Promoción guardada → valores del formulario (para editarla). */
export function promotionToFormValues(row: {
  id: string;
  name: string;
  label: string;
  type: PromotionType;
  rules: unknown;
  scope: PromotionScope;
  applies_to_sale_items: boolean;
  product_ids: string[];
  category_ids: string[];
  starts_at: string;
  ends_at: string;
}): PromotionFormValues {
  const v: PromotionFormValues = {
    ...EMPTY_PROMOTION,
    id: row.id,
    name: row.name,
    label: row.label,
    type: row.type,
    scope: row.scope,
    applies_to_sale_items: row.applies_to_sale_items,
    product_ids: row.product_ids,
    category_ids: row.category_ids,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
  };
  const parsed = promotionRules.safeParse({ type: row.type, rules: row.rules });
  if (!parsed.success) return v;
  const p = parsed.data;
  if (p.type === "buy_n_pay_m") return { ...v, buy: String(p.rules.buy), pay: String(p.rules.pay) };
  if (p.type === "nth_percent") {
    return { ...v, nth: String(p.rules.nth), nth_percent: bpsToInput(p.rules.percent_bps) };
  }
  return {
    ...v,
    volume_mode: p.rules.mode,
    tiers: p.rules.tiers.map((t) => ({
      qty: String(t.min_qty),
      value: p.rules.mode === "unit_price" ? centsToInput(t.value) : bpsToInput(t.value),
    })),
  };
}

const halfEven = (num: bigint, den: bigint) => {
  const q = num / den;
  const r = num % den;
  if (r * 2n > den || (r * 2n === den && q % 2n === 1n)) return q + 1n;
  return q;
};

/**
 * Ejemplo para la dueña con un solo producto: «Con un producto de $100: si lleva
 * 3, paga $200 y ahorra $100». Misma aritmética que el motor (mitad al par).
 * Para mayoreo por precio se toma un precio de ejemplo mayor al del primer escalón.
 */
export function promotionExample(
  p: PromotionRules,
  currency = "MXN",
): { price: number; qty: number; pay: number; save: number; text: string } {
  let price = 10000;
  let qty: number;
  let save: bigint;
  if (p.type === "buy_n_pay_m") {
    qty = p.rules.buy;
    save = BigInt(price) * BigInt(p.rules.buy - p.rules.pay);
  } else if (p.type === "nth_percent") {
    qty = p.rules.nth;
    save = halfEven(BigInt(price) * BigInt(p.rules.percent_bps), 10000n);
  } else {
    const first = p.rules.tiers[0]!;
    qty = first.min_qty;
    if (p.rules.mode === "unit_price") {
      // Precio de lista de ejemplo: el del escalón más un 25 %, redondeado a pesos.
      price = Math.max(Math.ceil((first.value * 1.25) / 100) * 100, first.value + 100);
      save = BigInt(price - first.value) * BigInt(qty);
    } else {
      save = halfEven(BigInt(price) * BigInt(qty) * BigInt(first.value), 10000n);
    }
  }
  const total = price * qty;
  const pay = total - Number(save);
  const m = (c: number) => formatMoney(c, currency);
  return {
    price,
    qty,
    pay,
    save: Number(save),
    text: `Ejemplo con un producto de ${m(price)}: si lleva ${qty}, paga ${m(pay)} en vez de ${m(total)} (ahorra ${m(Number(save))}).`,
  };
}
