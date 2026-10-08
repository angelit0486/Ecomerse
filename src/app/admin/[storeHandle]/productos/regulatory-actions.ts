"use server";

import { revalidatePath } from "next/cache";

import { supplementFieldLabel } from "@/lib/compliance/labels";
import { reportActionError } from "@/server/actions/report";
import {
  MAX_NUTRITION_ROWS,
  normalizeSupplementSheet,
  SUPPLEMENT_TEXT_LIMITS,
  type SheetErrorField,
} from "@/server/catalog/regulatory";
import { rpcDetail } from "@/server/compliance/errors";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { storeClient, type FormState } from "../_shared/action-state";
import { publishIssueMessage } from "./messages";

const TEXT_FIELDS = Object.keys(SUPPLEMENT_TEXT_LIMITS);
const CELLS = ["name", "amount", "unit", "dv"] as const;

function fieldMessage(field: SheetErrorField): string {
  if (field === "data") return "La ficha tiene datos que no se reconocen. Recarga la página.";
  if (field === "nutrition") {
    return "Cada renglón con datos necesita nutrimento y cantidad, sin «|» ni «;» (máximo 60 renglones).";
  }
  if (field === "servings_per_container") return "Escribe un número entero entre 1 y 100 000.";
  const max = SUPPLEMENT_TEXT_LIMITS[field as keyof typeof SUPPLEMENT_TEXT_LIMITS];
  return `${supplementFieldLabel(field)}: hasta ${max} caracteres, sin caracteres especiales.`;
}

/** Lo escrito en el formulario, para no perderlo tras un error. */
function readValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {
    classification: String(formData.get("classification") ?? ""),
    servings_per_container: String(formData.get("servings_per_container") ?? "").trim(),
  };
  for (const key of TEXT_FIELDS) values[key] = String(formData.get(key) ?? "");
  const rows = Math.min(Number(formData.get("nutrition_rows") ?? 0) || 0, MAX_NUTRITION_ROWS + 1);
  values.nutrition_rows = String(rows);
  for (let i = 0; i < rows; i += 1) {
    for (const cell of CELLS)
      values[`nutrition_${cell}_${i}`] = String(formData.get(`nutrition_${cell}_${i}`) ?? "");
  }
  return values;
}

/**
 * Clasificación y ficha sanitaria del producto (R-T02, ADR-021). La base valida
 * todo otra vez (catalog_save_regulatory_info) y no deja que uno publicado quede
 * sin cumplir.
 */
export async function saveRegulatoryInfo(
  storeHandle: string,
  productId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = readValues(formData);
  const classification = values.classification;
  if (!classification) {
    return {
      error: "Elige cómo se clasifica el producto.",
      fields: { classification: "required" },
      values,
    };
  }
  let category: string | null = null;
  let sheet: Record<string, unknown> = {};
  if (classification !== "none") {
    category = classification;
    const raw: Record<string, unknown> = {};
    for (const key of TEXT_FIELDS) raw[key] = values[key];
    if (values.servings_per_container) {
      raw.servings_per_container = /^\d{1,6}$/.test(values.servings_per_container)
        ? Number(values.servings_per_container)
        : Number.NaN;
    }
    const rows = Number(values.nutrition_rows);
    if (rows > MAX_NUTRITION_ROWS) {
      return {
        error: fieldMessage("nutrition"),
        fields: { nutrition: fieldMessage("nutrition") },
        values,
      };
    }
    raw.nutrition = Array.from({ length: rows }, (_, i) =>
      Object.fromEntries(CELLS.map((cell) => [cell, values[`nutrition_${cell}_${i}`] ?? ""])),
    );
    const result = normalizeSupplementSheet(raw);
    if (!result.ok) {
      const fields = Object.fromEntries(result.fields.map((f) => [f, fieldMessage(f)]));
      return { error: Object.values(fields)[0], fields, values };
    }
    sheet = result.sheet;
  }

  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "catalog_save_regulatory_info", {
      p_store_id: storeId,
      p_product_id: productId,
      p_category_key: category,
      p_data: sheet,
    });
    // La ficha se ve en la tienda pública (§21.4).
    invalidateStore(storeId);
  } catch (error) {
    const e = reportActionError("catalog", error);
    const { hint } = rpcDetail(error);
    if (e.code === "validation_failed" && e.fields?.regulatory) {
      const fields = Object.fromEntries(
        (hint ?? "data").split(",").map((f) => [f, fieldMessage(f as SheetErrorField)]),
      );
      return { error: Object.values(fields)[0], fields, values };
    }
    if (e.code === "validation_failed" && e.fields?.publish) {
      const issues = (hint ?? "").split(",").filter(Boolean).map(publishIssueMessage);
      return {
        error: `Este producto está publicado y dejaría de cumplir: ${issues.join(" ")} Corrígelo o despublícalo primero.`,
        values,
      };
    }
    if (e.code === "validation_failed" && e.fields?.category) {
      return {
        error:
          "Declara la categoría en Ajustes → Cumplimiento antes de clasificar productos en ella.",
        values,
      };
    }
    return {
      error: e.code === "forbidden" ? "Tu rol no permite editar la ficha sanitaria." : e.message,
      values,
    };
  }
  revalidatePath(`/admin/${storeHandle}/productos/${productId}`);
  return { ok: true, message: "Ficha sanitaria guardada." };
}
