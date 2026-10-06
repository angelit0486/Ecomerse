"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";

import { failureFrom, storeClient, type FormState } from "../_shared/action-state";

const failure = failureFrom("orders", { staff_note: "La nota puede tener hasta 4000 caracteres." });
const uuid = z.uuid();

export async function confirmManualPayment(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orderId).success) return { error: "Pedido no válido." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_mark_paid_manual", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_note: String(formData.get("note") ?? "").slice(0, 1000) || null,
    });
    // Las existencias publicadas cambian con la venta confirmada.
    invalidateStore(storeId);
  } catch (error) {
    const e = reportActionError("orders", error);
    if (e.code === "conflict")
      return { error: "Este pedido ya no está pendiente de pago (o su reserva venció)." };
    return { error: e.message };
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/${orderId}`);
  return { ok: true, message: "Pago confirmado. El pedido está listo para prepararse." };
}

export async function saveStaffNote(
  storeHandle: string,
  orderId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(orderId).success) return { error: "Pedido no válido." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "orders_set_staff_note", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_note: String(formData.get("staff_note") ?? ""),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/${storeHandle}/pedidos/${orderId}`);
  return { ok: true, message: "Nota guardada." };
}
