import { z } from "zod";

/**
 * Ficha de suplementos v1 (ADR-021). Espejo de app.regulatory_normalize
 * (supabase/migrations/20261016000100_regulatory_model.sql): aquí se validan los
 * formularios para dar errores de campo claros; la base vuelve a validar todo y
 * es la autoridad. Texto plano: lo escribe la tienda y el storefront lo escapa.
 */
export const REGULATED_CATEGORIES = ["dietary_supplement"] as const;
export type RegulatedCategory = (typeof REGULATED_CATEGORIES)[number];

export const SUPPLEMENT_TEXT_LIMITS = {
  form: 100,
  serving_size: 100,
  ingredients: 5000,
  usage: 2000,
  warnings: 3000,
  storage: 1000,
  allergens: 1000,
  sanitary_notice: 300,
} as const;
export const NUTRITION_CELL_LIMITS = { name: 100, amount: 30, unit: 20, dv: 10 } as const;
export const MAX_NUTRITION_ROWS = 60;
export const MAX_SERVINGS = 100_000;

export type SupplementTextField = keyof typeof SUPPLEMENT_TEXT_LIMITS;
export type SupplementField = SupplementTextField | "servings_per_container" | "nutrition";
export const SUPPLEMENT_FIELDS: readonly SupplementField[] = [
  "form",
  "serving_size",
  "servings_per_container",
  "ingredients",
  "nutrition",
  "usage",
  "warnings",
  "storage",
  "allergens",
  "sanitary_notice",
];

// Saltos de línea y tabuladores sí (ingredientes y advertencias en varias líneas).
const CONTROL_IN_TEXT = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_IN_CELL = /[\u0001-\u001F\u007F]/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL_IN_TEXT.test(v), "caracteres no permitidos");
// `|` y `;` separan renglones y celdas de la tabla en el CSV (R-T05, lib/catalog/compact).
const CSV_SEPARATORS = /[|;]/;
const cell = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !CONTROL_IN_CELL.test(v) && !CSV_SEPARATORS.test(v), "caracteres no permitidos");

const nutritionRow = z.object({
  name: cell(NUTRITION_CELL_LIMITS.name).optional(),
  amount: cell(NUTRITION_CELL_LIMITS.amount).optional(),
  unit: cell(NUTRITION_CELL_LIMITS.unit).optional(),
  dv: cell(NUTRITION_CELL_LIMITS.dv).optional(),
});

export const supplementSheetSchema = z.strictObject({
  form: text(SUPPLEMENT_TEXT_LIMITS.form).optional(),
  serving_size: text(SUPPLEMENT_TEXT_LIMITS.serving_size).optional(),
  servings_per_container: z.number().int().min(1).max(MAX_SERVINGS).optional(),
  ingredients: text(SUPPLEMENT_TEXT_LIMITS.ingredients).optional(),
  nutrition: z.array(nutritionRow).max(MAX_NUTRITION_ROWS).optional(),
  usage: text(SUPPLEMENT_TEXT_LIMITS.usage).optional(),
  warnings: text(SUPPLEMENT_TEXT_LIMITS.warnings).optional(),
  storage: text(SUPPLEMENT_TEXT_LIMITS.storage).optional(),
  allergens: text(SUPPLEMENT_TEXT_LIMITS.allergens).optional(),
  sanitary_notice: text(SUPPLEMENT_TEXT_LIMITS.sanitary_notice).optional(),
});
export type SupplementSheetInput = z.input<typeof supplementSheetSchema>;

export interface NutritionRow {
  name: string;
  amount: string;
  unit?: string;
  dv?: string;
}
export type SupplementSheet = Partial<Record<SupplementTextField, string>> & {
  servings_per_container?: number;
  nutrition?: NutritionRow[];
};

/** "data": campo fuera de la lista blanca (como el hint de la base). */
export type SheetErrorField = SupplementField | "data";
export type SheetResult =
  { ok: true; sheet: SupplementSheet } | { ok: false; fields: SheetErrorField[] };

/**
 * Valida y normaliza como la base: recorta, quita vacíos y renglones vacíos; un
 * renglón nutrimental con algo escrito necesita nombre y cantidad.
 */
export function normalizeSupplementSheet(input: unknown): SheetResult {
  const parsed = supplementSheetSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set<SheetErrorField>();
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      fields.add(
        typeof key === "string" && (SUPPLEMENT_FIELDS as readonly string[]).includes(key)
          ? (key as SupplementField)
          : "data",
      );
    }
    return { ok: false, fields: [...fields].sort() }; // mismo orden que el hint de la base
  }
  const sheet: SupplementSheet = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (key === "nutrition" || value === undefined) continue;
    if (key === "servings_per_container") sheet.servings_per_container = value as number;
    else if (value !== "") sheet[key as SupplementTextField] = value as string;
  }
  const rows: NutritionRow[] = [];
  for (const row of parsed.data.nutrition ?? []) {
    const clean = Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== undefined && v !== ""),
    );
    if (Object.keys(clean).length === 0) continue;
    if (!clean.name || !clean.amount) return { ok: false, fields: ["nutrition"] };
    rows.push(clean as unknown as NutritionRow);
  }
  if (rows.length > 0) sheet.nutrition = rows;
  return { ok: true, sheet };
}
