import { parseAttributes, parseNutrition } from "@/lib/catalog/compact";
import { parseMoneyToCents } from "@/lib/money/format";
import { productInputSchema } from "@/server/catalog/product-input";
import { normalizeSupplementSheet, REGULATED_CATEGORIES } from "@/server/catalog/regulatory";

/**
 * Plan de importación de productos (F8-T04b + Gate F8, GATE0 §26.1). Una fila por
 * variante, agrupadas por `handle`; la primera fila de cada grupo lleva los datos
 * del producto. Se valida con el MISMO esquema que el editor del catálogo; la base
 * vuelve a validar y resuelve contra lo existente (es la autoridad).
 *
 * Semántica (D-F8-06): una columna que no está en el archivo NO cambia nada; una
 * celda vacía borra el dato opcional (descripción, marca, categorías, etiquetas,
 * SEO, código de barras, precio de comparación, peso y medidas) y deja como están
 * los obligatorios o con valor por defecto (título, precio, estado, política,
 * envío). `inventory_quantity` vacío = no tocar las existencias. Nunca se inventan
 * datos.
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

/**
 * Columnas opcionales (R-T05): la ficha sanitaria y los atributos. La exportación
 * las incluye solo si la tienda las usa; la importación las acepta siempre.
 * `regulatory_category`: dietary_supplement, none (no regulado) o vacío (sin cambios).
 */
export const REGULATORY_FIELD_COLUMNS = [
  "regulatory_form",
  "regulatory_net_content",
  "regulatory_serving_size",
  "regulatory_servings_per_container",
  "regulatory_ingredients",
  "regulatory_nutrition",
  "regulatory_usage",
  "regulatory_warnings",
  "regulatory_storage",
  "regulatory_allergens",
  "regulatory_sanitary_notice",
] as const;
export const REGULATORY_HEADERS = ["regulatory_category", ...REGULATORY_FIELD_COLUMNS] as const;
export const ATTRIBUTE_HEADERS = ["attributes"] as const;
/**
 * Costo unitario de la variante (Fase B, `variant_costs`): opcional y sensible.
 * Importarlo exige products.cost.read; la exportación lo incluye solo con ese
 * permiso. Celda vacía = se borra el costo.
 */
export const COST_HEADERS = ["cost"] as const;
/**
 * Contenido neto y porciones de cada presentación (ADR-026): vacías, vale el dato
 * de la ficha del producto. La exportación las incluye con la ficha sanitaria.
 */
export const VARIANT_SUPPLEMENT_HEADERS = ["variant_net_content", "variant_servings"] as const;
export const MAX_VARIANT_SERVINGS = 10_000;
export const ALL_IMPORT_HEADERS = [
  ...IMPORT_HEADERS,
  ...COST_HEADERS,
  ...REGULATORY_HEADERS,
  ...VARIANT_SUPPLEMENT_HEADERS,
  ...ATTRIBUTE_HEADERS,
] as const;
export type ImportColumn = (typeof ALL_IMPORT_HEADERS)[number];

export const MAX_IMPORT_ROWS = 5000;
/** Vercel rechaza cuerpos de más de 4.5 MB: 4 MB de archivo + el multipart. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_QUANTITY = 1_000_000;

export interface PlannedVariant {
  row_number: number;
  options?: Record<string, string>;
  sku?: string | null;
  barcode?: string | null;
  price?: number;
  compare_at_price?: number | null;
  /** Centavos; null = se borra el costo (Fase B). */
  cost?: number | null;
  /** ADR-026; null = vale el dato del producto. */
  net_content?: string | null;
  servings_per_container?: number | null;
  weight_g?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  requires_shipping?: boolean;
  inventory_policy?: "deny" | "continue";
  status?: "active" | "inactive";
  /** Existencias físicas de la ubicación principal (ausente = no se tocan). */
  quantity?: number;
}

export interface PlannedProduct {
  handle: string;
  product: {
    title?: string;
    description_html?: string | null;
    tags?: string[];
    seo_title?: string | null;
    seo_description?: string | null;
  };
  status?: "draft" | "active" | "archived";
  /** category null = no regulado; data: campo → valor (null = se borra). */
  regulatory?: { category: string | null; data: Record<string, unknown> };
  /** Clave del atributo → claves de sus valores; {} = sin atributos. */
  attributes?: Record<string, string[]>;
  brand?: string | null;
  categories?: string[];
  /** null: el archivo no trae columnas de opciones. */
  option_names: string[] | null;
  variants: PlannedVariant[];
}

export interface PlannedRow {
  row_number: number;
  raw: Record<string, string>;
  errors: string[];
  /** Solo en la primera fila de cada producto. */
  normalized: PlannedProduct | null;
}

export type HeaderCheck =
  | { ok: true; columns: ImportColumn[]; ignored: string[] }
  | { ok: false; missing: string[]; duplicated: string[] };

const KNOWN = new Set<string>(ALL_IMPORT_HEADERS);

export function checkHeaders(headers: string[]): HeaderCheck {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const h of headers) {
    if (KNOWN.has(h) && seen.has(h)) duplicated.add(h);
    seen.add(h);
  }
  const missing = seen.has("handle") ? [] : ["handle"];
  // La ficha necesita su clasificación para guardarse.
  if (REGULATORY_FIELD_COLUMNS.some((c) => seen.has(c)) && !seen.has("regulatory_category")) {
    missing.push("regulatory_category");
  }
  if (missing.length || duplicated.size) return { ok: false, missing, duplicated: [...duplicated] };
  return {
    ok: true,
    columns: ALL_IMPORT_HEADERS.filter((h) => seen.has(h)),
    // Columnas ajenas (p. ej. store_id) se ignoran y se avisan: la tienda la fija
    // la URL del panel y el job, nunca el archivo (§26.1, CF-10).
    ignored: [...new Set(headers.filter((h) => h && !KNOWN.has(h)))].map((h) => h.slice(0, 100)),
  };
}

/** Quita el apóstrofo con que la exportación neutraliza fórmulas (ida y vuelta). */
const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
};

function money(v: string, field: string, errors: string[]): number | null {
  // Excel en español escribe "199,50": coma decimal sin separador de miles.
  const normalized = /^\d+,\d{1,2}$/.test(v) ? v.replace(",", ".") : v;
  const cents = parseMoneyToCents(normalized);
  if (cents === null) errors.push(`${field}: escribe un importe como 199.50`);
  return cents;
}

function integer(v: string, field: string, errors: string[], max = 999_999_999): number | null {
  if (!/^\d{1,9}$/.test(v) || Number(v) > max) {
    errors.push(`${field}: escribe un número entero entre 0 y ${max}`);
    return null;
  }
  return Number(v);
}

function bool(v: string, field: string, errors: string[]): boolean | undefined {
  const t = v.toLowerCase();
  if (["true", "sí", "si", "1", "yes"].includes(t)) return true;
  if (["false", "no", "0"].includes(t)) return false;
  errors.push(`${field}: usa true o false`);
  return undefined;
}

function oneOf<T extends string>(
  v: string,
  allowed: readonly T[],
  field: string,
  errors: string[],
): T | undefined {
  const t = v.toLowerCase();
  if ((allowed as readonly string[]).includes(t)) return t as T;
  errors.push(`${field}: usa ${allowed.join(", ")}`);
  return undefined;
}

const list = (v: string) =>
  v
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

const DIMENSIONS = ["weight_g", "length_mm", "width_mm", "height_mm"] as const;

export function planProductImport(
  headers: string[],
  rows: string[][],
  /** Fila de la hoja de cada fila (parseCsv); por defecto, consecutivas desde la 2. */
  rowNumbers?: number[],
): PlannedRow[] {
  // Solo columnas de la plantilla; la primera aparición de cada una.
  const index = new Map<ImportColumn, number>();
  headers.forEach((h, i) => {
    if (KNOWN.has(h) && !index.has(h as ImportColumn)) index.set(h as ImportColumn, i);
  });
  const has = (k: ImportColumn) => index.has(k);
  const planned: PlannedRow[] = rows.map((cells, i) => ({
    row_number: rowNumbers?.[i] ?? i + 2, // fila 1 = encabezado, como en la hoja de cálculo
    raw: Object.fromEntries([...index].map(([h, j]) => [h, cells[j] ?? ""])),
    // Celdas de más: una coma o unas comillas mal puestas desplazarían los datos.
    errors: cells.slice(headers.length).some((c) => c.trim() !== "")
      ? ["la fila tiene más celdas que el encabezado: revisa comas y comillas"]
      : [],
    normalized: null,
  }));

  const groups = new Map<string, PlannedRow[]>();
  for (const row of planned) {
    const handle = clean(row.raw.handle).toLowerCase();
    if (!handle) {
      row.errors.push("handle: es obligatorio");
      continue;
    }
    groups.set(handle, [...(groups.get(handle) ?? []), row]);
  }

  const skus = new Map<string, number>();
  for (const [handle, group] of groups) {
    const first = group[0]!;
    const f = (k: ImportColumn) => clean(first.raw[k]);
    const fe = first.errors;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle) || handle.length > 120) {
      fe.push("handle: usa minúsculas, números y guiones");
    }

    const product: PlannedProduct["product"] = {};
    // Título y precio vacíos = sin cambios (no se pueden borrar); la base exige
    // el título al crear y el precio en cada variante nueva.
    if (has("title") && f("title")) product.title = f("title");
    if (has("description")) product.description_html = f("description") || null;
    if (has("tags")) product.tags = list(f("tags"));
    if (has("seo_title")) product.seo_title = f("seo_title") || null;
    if (has("seo_description")) product.seo_description = f("seo_description") || null;
    const normalized: PlannedProduct = { handle, product, option_names: null, variants: [] };
    if (has("status") && f("status")) {
      normalized.status = oneOf(
        f("status"),
        ["draft", "active", "archived"] as const,
        "status",
        fe,
      );
    }
    if (has("brand")) normalized.brand = f("brand") || null;
    if (has("categories")) normalized.categories = list(f("categories"));
    if (has("regulatory_category")) planRegulatory(f, has, normalized, fe);
    if (has("attributes")) {
      const parsed = parseAttributes(f("attributes"));
      if (parsed.ok) normalized.attributes = parsed.value;
      else fe.push(`attributes: ${parsed.error}`);
    }

    // Opciones: mismos nombres en todas las filas del producto.
    const optionColumns = ([1, 2, 3] as const).filter((n) => has(`option${n}_name`));
    // Cada nombre con su propia columna de valor (option2 puede venir sin option1).
    const slots = optionColumns
      .map((n) => ({ n, name: f(`option${n}_name`) }))
      .filter((slot) => slot.name);
    const optionNames = slots.map((slot) => slot.name);
    if (optionColumns.length > 0) normalized.option_names = optionNames;
    if (new Set(optionNames.map((n) => n.toLowerCase())).size !== optionNames.length) {
      fe.push("option*_name: cada opción del producto debe tener un nombre distinto");
    }
    const seenCombos = new Map<string, number>();

    for (const row of group) {
      const e = row.errors;
      const g = (k: ImportColumn) => clean(row.raw[k]);
      const variant: PlannedVariant = { row_number: row.row_number };
      if (optionColumns.length > 0) {
        const names = optionColumns.map((n) => g(`option${n}_name`)).filter(Boolean);
        if (row !== first && names.length > 0 && names.join("|") !== optionNames.join("|")) {
          e.push("option*_name: deben coincidir con la primera fila del producto");
        }
        const options: Record<string, string> = {};
        for (const { n, name } of slots) {
          const value = has(`option${n}_value`) ? g(`option${n}_value`) : "";
          if (!value) e.push(`option${n}_value: falta el valor de ${name}`);
          else options[name] = value;
        }
        variant.options = options;
        if (optionNames.length > 0) {
          const key = JSON.stringify(Object.entries(options).map(([k, v]) => [k, v.toLowerCase()]));
          const before = seenCombos.get(key);
          if (before) e.push(`opciones: la misma combinación ya está en la fila ${before}`);
          else seenCombos.set(key, row.row_number);
        }
      }
      if (has("sku")) {
        const sku = g("sku").toUpperCase() || null;
        variant.sku = sku;
        if (sku) {
          const before = skus.get(sku);
          if (before) e.push(`sku: repetido (también en la fila ${before})`);
          else skus.set(sku, row.row_number);
        }
      }
      if (has("barcode")) variant.barcode = g("barcode") || null;
      if (has("price") && g("price")) {
        const price = money(g("price"), "price", e);
        if (price !== null) variant.price = price;
      }
      if (has("compare_at_price")) {
        variant.compare_at_price = g("compare_at_price")
          ? money(g("compare_at_price"), "compare_at_price", e)
          : null;
      }
      if (has("cost")) variant.cost = g("cost") ? money(g("cost"), "cost", e) : null;
      if (has("variant_net_content")) {
        const value = g("variant_net_content");
        if (value.length > 100) e.push("variant_net_content: máximo 100 caracteres");
        else variant.net_content = value || null;
      }
      if (has("variant_servings")) {
        const value = g("variant_servings");
        if (!value) variant.servings_per_container = null;
        else if (
          !/^\d{1,5}$/.test(value) ||
          Number(value) < 1 ||
          Number(value) > MAX_VARIANT_SERVINGS
        ) {
          e.push(`variant_servings: escribe un número entero entre 1 y ${MAX_VARIANT_SERVINGS}`);
        } else variant.servings_per_container = Number(value);
      }
      for (const k of DIMENSIONS) {
        if (has(k)) variant[k] = g(k) ? integer(g(k), k, e) : null;
      }
      if (has("requires_shipping") && g("requires_shipping")) {
        variant.requires_shipping = bool(g("requires_shipping"), "requires_shipping", e);
      }
      if (has("inventory_policy") && g("inventory_policy")) {
        variant.inventory_policy = oneOf(
          g("inventory_policy"),
          ["deny", "continue"] as const,
          "inventory_policy",
          e,
        );
      }
      if (has("variant_status") && g("variant_status")) {
        variant.status = oneOf(
          g("variant_status"),
          ["active", "inactive"] as const,
          "variant_status",
          e,
        );
      }
      if (has("inventory_quantity") && g("inventory_quantity")) {
        const quantity = integer(
          g("inventory_quantity"),
          "inventory_quantity",
          e,
          MAX_IMPORT_QUANTITY,
        );
        if (quantity !== null) variant.quantity = quantity;
      }
      normalized.variants.push(variant);
    }
    if (
      optionNames.length === 0 &&
      group.length > 1 &&
      group.some((r, i) => !normalized.variants[i]!.sku)
    ) {
      fe.push(
        "sin columnas de opciones, cada fila del producto necesita su SKU (o agrega las columnas de opciones)",
      );
    }

    // Formato de cada dato con el mismo esquema que el editor; lo ausente se
    // completa con un valor neutro solo para validar.
    const probe = {
      title: product.title ?? "x",
      slug: handle,
      description_html: product.description_html ?? null,
      tags: product.tags ?? [],
      seo_title: product.seo_title ?? null,
      seo_description: product.seo_description ?? null,
      options: optionNames.map((name) => ({
        name,
        values: [
          ...new Set(
            normalized.variants.map((v) => v.options?.[name]).filter((v): v is string => !!v),
          ),
        ],
      })),
      variants: normalized.variants.map((v, i) => ({
        options: v.options ?? {},
        sku: v.sku ?? null,
        barcode: v.barcode ?? null,
        price: v.price ?? 0,
        compare_at_price: v.price === undefined ? null : (v.compare_at_price ?? null),
        weight_g: v.weight_g ?? null,
        status: v.status ?? "active",
        inventory_policy: v.inventory_policy ?? "deny",
        requires_shipping: v.requires_shipping ?? true,
        position: i,
      })),
    };
    const check = productInputSchema.safeParse(probe);
    if (!check.success) {
      for (const issue of check.error.issues) {
        const [k0, k1, k2] = issue.path;
        const inVariant = k0 === "variants" && typeof k1 === "number";
        const errors = inVariant ? group[k1]!.errors : fe;
        const field = inVariant ? String(k2 ?? "variante") : String(k0 ?? "producto");
        // Un campo ya señalado con un mensaje propio no se repite.
        if (errors.some((m) => m.startsWith(`${field}:`))) continue;
        errors.push(
          issue.message === "mayor_que_precio"
            ? "compare_at_price: debe ser mayor que price"
            : `${field}: valor no válido`,
        );
      }
    } else if (has("description")) {
      product.description_html = check.data.description_html ?? null;
    }
    first.normalized = normalized;
  }
  return planned;
}

/** Ficha sanitaria de la primera fila del producto (R-T05). La base vuelve a validar. */
function planRegulatory(
  f: (k: ImportColumn) => string,
  has: (k: ImportColumn) => boolean,
  normalized: PlannedProduct,
  errors: string[],
) {
  const category = f("regulatory_category").toLowerCase();
  const present = REGULATORY_FIELD_COLUMNS.filter((c) => has(c));
  const filled = present.filter((c) => f(c));
  if (!category) {
    if (filled.length > 0) {
      errors.push("regulatory_category: indica dietary_supplement o none para guardar la ficha");
    }
    return;
  }
  if (category === "none") {
    if (filled.length > 0) {
      errors.push("regulatory_category: un producto no regulado no lleva ficha sanitaria");
    }
    normalized.regulatory = { category: null, data: {} };
    return;
  }
  if (!(REGULATED_CATEGORIES as readonly string[]).includes(category)) {
    errors.push("regulatory_category: usa dietary_supplement o none");
    return;
  }
  const data: Record<string, unknown> = {};
  let ok = true;
  for (const column of present) {
    const field = column.slice("regulatory_".length);
    const value = f(column);
    if (!value) {
      data[field] = null;
    } else if (field === "servings_per_container") {
      if (/^\d{1,6}$/.test(value)) data[field] = Number(value);
      else {
        errors.push(`${column}: escribe un número entero`);
        ok = false;
      }
    } else if (field === "nutrition") {
      const rows = parseNutrition(value);
      if (rows.ok) data[field] = rows.value.length > 0 ? rows.value : null;
      else {
        errors.push(`${column}: ${rows.error}`);
        ok = false;
      }
    } else {
      data[field] = value;
    }
  }
  if (ok) {
    const filledData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
    const check = normalizeSupplementSheet(filledData);
    if (!check.ok) {
      for (const field of check.fields) errors.push(`regulatory_${field}: valor no válido`);
    }
  }
  normalized.regulatory = { category, data };
}
