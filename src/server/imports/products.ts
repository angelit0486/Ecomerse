import { parseMoneyToCents } from "@/lib/money/format";
import { productInputSchema } from "@/server/catalog/product-input";

/**
 * Plan de importación de productos (F8-T04b, GATE0 §26.1). Una fila por
 * variante, agrupadas por `handle`; la primera fila de cada grupo lleva los
 * datos del producto. Se valida con el MISMO esquema que el editor del
 * catálogo; la base vuelve a validar todo al confirmar (es la autoridad).
 * Nunca se inventan datos: una celda vacía queda vacía.
 */
export const IMPORT_HEADERS = [
  "handle",
  "title",
  "status",
  "description",
  "brand",
  "categories",
  "tags",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "sku",
  "barcode",
  "price",
  "compare_at_price",
  "inventory_quantity",
  "inventory_policy",
  "requires_shipping",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
  "variant_status",
  "seo_title",
  "seo_description",
] as const;
const REQUIRED = ["handle", "price"] as const;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface PlannedRow {
  row_number: number;
  raw: Record<string, string>;
  errors: string[];
  /** Solo en la primera fila de cada producto. */
  normalized: PlannedProduct | null;
}

export interface PlannedProduct {
  handle: string;
  publish: boolean;
  brand: string | null;
  categories: string[];
  payload: Record<string, unknown>;
  /** Existencias absolutas por variante (índice de `payload.variants`). */
  inventory: { variant_index: number; quantity: number; row_number: number }[];
}

export type HeaderCheck = { ok: true } | { ok: false; missing: string[]; unknown: string[] };

export function checkHeaders(headers: string[]): HeaderCheck {
  const known = new Set<string>(IMPORT_HEADERS);
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  // Columnas ajenas (p. ej. store_id) no se aceptan: nunca deciden la tienda (§26.1).
  const unknown = headers.filter((h) => h && !known.has(h));
  return missing.length || unknown.length ? { ok: false, missing, unknown } : { ok: true };
}

/** Quita el apóstrofo con que la exportación neutraliza fórmulas (ida y vuelta). */
const text = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
};
const optionalInt = (v: string, field: string, errors: string[]) => {
  if (!v) return null;
  if (!/^\d{1,9}$/.test(v)) {
    errors.push(`${field}: escribe un número entero`);
    return null;
  }
  return Number(v);
};
const money = (v: string, field: string, errors: string[], required: boolean) => {
  if (!v) {
    if (required) errors.push(`${field}: es obligatorio`);
    return null;
  }
  // Excel en español escribe "199,50": coma decimal sin separador de miles.
  const normalized = /^\d+,\d{1,2}$/.test(v) ? v.replace(",", ".") : v;
  const cents = parseMoneyToCents(normalized);
  if (cents === null) errors.push(`${field}: escribe un importe como 199.50`);
  return cents;
};
const bool = (v: string, field: string, errors: string[]) => {
  if (!v) return null;
  const t = v.toLowerCase();
  if (["true", "sí", "si", "1", "yes"].includes(t)) return true;
  if (["false", "no", "0"].includes(t)) return false;
  errors.push(`${field}: usa true o false`);
  return null;
};

export function planProductImport(headers: string[], rows: string[][]): PlannedRow[] {
  const records = rows.map((cells, i) => ({
    row_number: i + 2, // fila 1 = encabezado, como en la hoja de cálculo
    raw: Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ""])),
  }));
  const groups = new Map<string, typeof records>();
  const planned: PlannedRow[] = records.map((r) => ({ ...r, errors: [], normalized: null }));
  const byRow = new Map(planned.map((p) => [p.row_number, p]));
  for (const r of records) {
    const handle = text(r.raw.handle).toLowerCase();
    if (!handle) {
      byRow.get(r.row_number)!.errors.push("handle: es obligatorio");
      continue;
    }
    groups.set(handle, [...(groups.get(handle) ?? []), r]);
  }

  const skus = new Map<string, number>();
  for (const [handle, group] of groups) {
    const first = group[0]!;
    const firstPlan = byRow.get(first.row_number)!;
    const f = (k: string) => text(first.raw[k]);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle) || handle.length > 120) {
      firstPlan.errors.push("handle: usa minúsculas, números y guiones");
    }
    if (!f("title")) firstPlan.errors.push("title: es obligatorio en la primera fila del producto");
    const status = f("status") || "draft";
    // archived se acepta para reimportar una exportación: no publica ni archiva.
    if (!["draft", "active", "archived"].includes(status)) {
      firstPlan.errors.push("status: usa draft, active o archived");
    }

    // Opciones: mismos nombres en todas las filas del producto.
    const optionNames = [1, 2, 3].map((n) => f(`option${n}_name`)).filter(Boolean);
    const optionValues = new Map<string, Set<string>>(optionNames.map((n) => [n, new Set()]));
    const variants: Record<string, unknown>[] = [];
    const inventory: PlannedProduct["inventory"] = [];
    for (const [index, r] of group.entries()) {
      const plan = byRow.get(r.row_number)!;
      const e = plan.errors;
      const g = (k: string) => text(r.raw[k]);
      const names = [1, 2, 3].map((n) => g(`option${n}_name`)).filter(Boolean);
      if (index > 0 && names.length > 0 && names.join("|") !== optionNames.join("|")) {
        e.push("option*_name: deben coincidir con la primera fila del producto");
      }
      const options: Record<string, string> = {};
      optionNames.forEach((name, i) => {
        const value = g(`option${i + 1}_value`);
        if (!value) e.push(`option${i + 1}_value: falta el valor de ${name}`);
        else {
          options[name] = value;
          optionValues.get(name)!.add(value);
        }
      });
      const sku = g("sku").toUpperCase() || null;
      if (sku) {
        if (skus.has(sku)) e.push(`sku: repetido (también en la fila ${skus.get(sku)})`);
        else skus.set(sku, r.row_number);
      }
      const policy = g("inventory_policy") || "deny";
      if (!["deny", "continue"].includes(policy)) e.push("inventory_policy: usa deny o continue");
      const vstatus = g("variant_status") || "active";
      if (!["active", "inactive"].includes(vstatus))
        e.push("variant_status: usa active o inactive");
      const qty = optionalInt(g("inventory_quantity"), "inventory_quantity", e);
      if (qty !== null)
        inventory.push({ variant_index: index, quantity: qty, row_number: r.row_number });
      const variant = {
        options,
        sku,
        barcode: g("barcode") || null,
        price: money(g("price"), "price", e, true) ?? 0,
        compare_at_price: money(g("compare_at_price"), "compare_at_price", e, false),
        weight_g: optionalInt(g("weight_g"), "weight_g", e),
        length_mm: optionalInt(g("length_mm"), "length_mm", e),
        width_mm: optionalInt(g("width_mm"), "width_mm", e),
        height_mm: optionalInt(g("height_mm"), "height_mm", e),
        requires_shipping: bool(g("requires_shipping"), "requires_shipping", e) ?? true,
        inventory_policy: policy,
        status: vstatus,
        position: index,
      };
      variants.push(variant);
    }

    const payload = {
      title: f("title"),
      slug: handle,
      description_html: f("description") || null,
      tags: f("tags")
        ? f("tags")
            .split("|")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      seo_title: f("seo_title") || null,
      seo_description: f("seo_description") || null,
      options: optionNames.map((name) => ({ name, values: [...optionValues.get(name)!] })),
      variants,
    };
    // El mismo esquema que el editor; los errores se asignan a su fila.
    const check = productInputSchema.safeParse(payload);
    if (!check.success) {
      for (const issue of check.error.issues) {
        const [k0, k1, k2] = issue.path;
        const [errors, field] =
          k0 === "variants" && typeof k1 === "number"
            ? [byRow.get(group[k1]!.row_number)!.errors, String(k2 ?? "variante")]
            : [firstPlan.errors, String(k0 ?? "producto")];
        // Un campo ya señalado con un mensaje propio no se repite.
        if (!errors.some((m) => m.startsWith(`${field}:`)))
          errors.push(`${field}: valor no válido`);
      }
    }
    const variantKeys = new Set(variants.map((v) => JSON.stringify(v.options)));
    if (variantKeys.size !== variants.length) {
      firstPlan.errors.push("opciones: dos filas del producto tienen la misma combinación");
    }
    firstPlan.normalized = {
      handle,
      publish: status === "active",
      brand: f("brand") || null,
      categories: f("categories")
        ? f("categories")
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
        : [],
      payload: check.success
        ? { ...payload, description_html: check.data.description_html }
        : payload,
      inventory,
    };
  }
  return planned;
}
