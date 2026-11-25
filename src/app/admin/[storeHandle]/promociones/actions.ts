"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  FIELD_MESSAGES,
  parsePromotionForm,
  promotionValuesFromFormData,
} from "@/lib/promotions/form";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, storeClient, type FormState } from "../_shared/action-state";

/** Detalles de `validation_failed` de la base → mensaje para la dueña. */
const MESSAGES: Record<string, string> = {
  ...FIELD_MESSAGES,
  rules: "Revisa la regla de la promoción.",
  promotion: "Revisa los datos de la promoción.",
  promotion_locked:
    "Esta promoción ya se usó en pedidos: su regla y a qué aplica ya no cambian. Puedes cambiar el nombre, la leyenda y las fechas, o crear otra.",
  status: "Ese cambio de estado no se puede hacer.",
  ended: "La promoción ya terminó: cambia la fecha «Hasta» para volver a activarla.",
};
const failure = failureFrom("promotions", MESSAGES);
const base = (h: string) => `/admin/${h}/promociones`;

export async function savePromotion(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const v = promotionValuesFromFormData(formData);
  const values = { id: v.id };
  const parsed = parsePromotionForm(v);
  if (!parsed.ok) {
    return {
      error: Object.values(parsed.fields)[0] ?? MESSAGES.promotion,
      fields: parsed.fields as Record<string, string>,
      values,
    };
  }
  let id: string;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    id = await callRpc<string>(supabase, "promotions_upsert", {
      p_store_id: storeId,
      p_promotion: parsed.payload,
    });
    // Las tarjetas y la ficha de la tienda anuncian la promoción (fase 3).
    invalidateStore(storeId);
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(base(storeHandle));
  if (!v.id) redirect(`${base(storeHandle)}/${id}?creada=1`);
  revalidatePath(`${base(storeHandle)}/${id}`);
  return { ok: true, message: "Promoción guardada." };
}

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["active", "paused", "archived"]) });
const STATUS_DONE: Record<string, string> = {
  active: "Promoción activada: ya se aplica en el carrito.",
  paused: "Promoción pausada.",
  archived: "Promoción archivada.",
};

export async function setPromotionStatus(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = statusSchema.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return { error: MESSAGES.status };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "promotions_set_status", {
      p_store_id: storeId,
      p_promotion_id: parsed.data.id,
      p_status: parsed.data.status,
    });
    invalidateStore(storeId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle));
  revalidatePath(`${base(storeHandle)}/${parsed.data.id}`);
  if (parsed.data.status === "archived" && formData.get("from") === "detail") {
    redirect(`${base(storeHandle)}?archivada=1`);
  }
  return { ok: true, message: STATUS_DONE[parsed.data.status] };
}
