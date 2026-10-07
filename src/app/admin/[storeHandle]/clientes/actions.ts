"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { callRpc } from "@/server/db/rpc";

import { failureFrom, formValues, storeClient, type FormState } from "../_shared/action-state";

const uuid = z.uuid();
const failure = failureFrom("customers", {
  name: "Escribe un nombre de hasta 80 caracteres.",
  phone: "Escribe un teléfono válido.",
  note: "La nota puede tener hasta 2000 caracteres.",
  accepts_marketing: "Solo el cliente puede aceptar recibir publicidad (en el checkout).",
  reason: "Escribe el motivo (3 a 500 caracteres).",
});

export async function updateCustomer(
  storeHandle: string,
  customerId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(customerId).success) return { error: "Cliente no válido." };
  const values = formValues(formData, ["first_name", "last_name", "phone", "note"]);
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "customers_update", {
      p_store_id: storeId,
      p_customer_id: customerId,
      p_first_name: values.first_name,
      p_last_name: values.last_name,
      p_phone: values.phone,
      p_note: values.note,
      // Solo se puede retirar: si la casilla no viene, se retira; si viene, se mantiene.
      p_accepts_marketing: formData.get("accepts_marketing") === "1" ? null : false,
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(`/admin/${storeHandle}/clientes/${customerId}`);
  return { ok: true, message: "Cliente actualizado." };
}

export async function anonymizeCustomer(
  storeHandle: string,
  customerId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(customerId).success) return { error: "Cliente no válido." };
  const values = formValues(formData, ["reason"]);
  if (formData.get("confirm") !== "1") {
    return { error: "Confirma que entiendes que no se puede deshacer.", values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "customers_anonymize", {
      p_store_id: storeId,
      p_customer_id: customerId,
      p_reason: values.reason,
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(`/admin/${storeHandle}/clientes/${customerId}`);
  return { ok: true, message: "Datos personales eliminados." };
}
