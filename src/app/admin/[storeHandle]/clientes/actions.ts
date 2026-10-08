"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";

import { failureFrom, formValues, storeClient, type FormState } from "../_shared/action-state";
import { SEARCH_COOKIE } from "./search";

const uuid = z.uuid();
const failure = failureFrom("customers", {
  name: "Escribe un nombre de hasta 80 caracteres.",
  phone: "Escribe un teléfono válido.",
  note: "La nota puede tener hasta 2000 caracteres.",
  accepts_marketing: "Solo el cliente puede aceptar recibir publicidad (en el checkout).",
  reason: "Escribe el motivo (3 a 500 caracteres).",
});

export async function searchCustomers(storeHandle: string, formData: FormData): Promise<void> {
  const { ctx } = await storeClient(storeHandle);
  const base = `/admin/${ctx.store.handle}/clientes`;
  const q = String(formData.get("q") ?? "")
    .trim()
    .slice(0, 100);
  const jar = await cookies();
  if (q) {
    jar.set(SEARCH_COOKIE, q, {
      httpOnly: true,
      secure: ["production", "preview"].includes(serverEnv().APP_ENV),
      sameSite: "strict",
      path: base,
      maxAge: 30 * 60,
    });
  } else {
    jar.delete({ name: SEARCH_COOKIE, path: base });
  }
  redirect(base);
}

export async function updateCustomer(
  storeHandle: string,
  customerId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!uuid.safeParse(customerId).success) return { error: "Cliente no válido." };
  const values: Record<string, string> = {
    ...formValues(formData, ["first_name", "last_name", "phone", "note"]),
    // La casilla también se conserva tras un error (React reinicia el formulario).
    accepts_marketing: formData.get("accepts_marketing") === "1" ? "1" : "0",
  };
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
  const values: Record<string, string> = {
    ...formValues(formData, ["reason"]),
    confirm: formData.get("confirm") === "1" ? "1" : "",
  };
  if (values.confirm !== "1") {
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
