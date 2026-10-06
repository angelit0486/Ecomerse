"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { getStoreContext } from "@/server/auth/store-context";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";

/**
 * Acciones de inventario (F4-T03). La tienda sale de la URL; la base valida
 * permiso (inventory.adjust), motivo y existencias (§15.3). Cada formulario
 * lleva su propia clave de idempotencia: un doble envío no ajusta dos veces.
 */
export interface InventoryActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  /** Lo escrito, para no perderlo cuando hay un error (React reinicia el formulario). */
  values?: Record<string, string>;
}

const MESSAGES: Record<string, string> = {
  reason: "Escribe el motivo (de 3 a 500 caracteres).",
  quantity: "Escribe una cantidad válida, distinta de la actual.",
  type: "Elige el tipo de movimiento.",
  mode: "Fijar la cantidad solo vale para ajustes.",
  threshold: "Escribe un número entero de 0 en adelante, o déjalo vacío.",
};

const adjustSchema = z.object({
  variant_id: z.uuid(),
  type: z.enum(["adjustment", "damage", "loss"]),
  mode: z.enum(["delta", "set"]),
  quantity: z.coerce.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().trim().min(3).max(500),
  idempotency_key: z.string().regex(/^[0-9a-f-]{36}$/),
});

function failure(error: unknown): InventoryActionState {
  const appError = reportActionError("inventory", error);
  if (appError.code === "insufficient_stock") {
    return { error: "No puedes dejar menos de 0 unidades en mano (o menos de lo ya reservado)." };
  }
  const fields = appError.fields
    ? Object.fromEntries(
        Object.keys(appError.fields).map((k) => [k, MESSAGES[k] ?? "Revisa este dato."]),
      )
    : undefined;
  return { error: appError.message, ...(fields ? { fields } : {}) };
}

export async function adjustInventory(
  storeHandle: string,
  _: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  const values = {
    quantity: String(formData.get("quantity") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fields[key] ??= MESSAGES[key] ?? "Revisa este dato.";
    }
    return { error: "Revisa los datos marcados.", fields, values };
  }
  const input = parsed.data;
  let result: { on_hand: number; available: number };
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    result = await callRpc(supabase, "inventory_adjust", {
      p_store_id: ctx.store.id,
      p_variant_id: input.variant_id,
      p_type: input.type,
      p_quantity: input.quantity,
      p_reason: input.reason,
      p_mode: input.mode,
      p_idempotency_key: input.idempotency_key,
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(`/admin/${storeHandle}/inventario`, "layout");
  return {
    ok: true,
    message: `Listo: ${result.on_hand} en mano, ${result.available} disponibles.`,
  };
}

export async function setLowStockThreshold(
  storeHandle: string,
  _: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const variantId = String(formData.get("variant_id") ?? "");
  const raw = String(formData.get("threshold") ?? "").trim();
  const threshold = raw === "" ? null : Number(raw);
  if (!z.uuid().safeParse(variantId).success) return { error: "Variante no válida." };
  if (
    threshold !== null &&
    (!Number.isInteger(threshold) || threshold < 0 || threshold > 1_000_000)
  ) {
    return { error: "Revisa los datos marcados.", fields: { threshold: MESSAGES.threshold! } };
  }
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "inventory_set_threshold", {
      p_store_id: ctx.store.id,
      p_variant_id: variantId,
      p_threshold: threshold,
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/${storeHandle}/inventario`, "layout");
  return {
    ok: true,
    message:
      threshold === null
        ? "Aviso de stock bajo desactivado."
        : `Aviso de stock bajo en ${threshold}.`,
  };
}
