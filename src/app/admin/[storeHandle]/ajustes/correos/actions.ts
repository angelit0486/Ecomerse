"use server";

import { revalidatePath } from "next/cache";

import { EDITABLE_KEYS } from "@/lib/emails/store-texts";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";

import { storeClient, type FormState } from "../../_shared/action-state";

/** Guarda el asunto y el mensaje de un correo (paso 20); permisos y límites, en la base. */
export async function saveEmailText(
  storeHandle: string,
  template: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const subject = String(formData.get("subject") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const values = { subject, note };
  if (!EDITABLE_KEYS.has(template)) return { error: "Correo no válido.", values };
  if (subject.length > 150) {
    const msg = "El asunto puede tener hasta 150 caracteres.";
    return { error: msg, fields: { subject: msg }, values };
  }
  if (note.length > 1000) {
    const msg = "El mensaje puede tener hasta 1000 caracteres.";
    return { error: msg, fields: { note: msg }, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "email_texts_save", {
      p_store_id: storeId,
      p_template: template,
      p_subject: subject || null,
      p_note: note || null,
    });
  } catch (error) {
    return { error: reportActionError("email_texts", error).message, values };
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/correos`);
  return {
    ok: true,
    message: subject || note ? "Texto guardado." : "Volvió al texto de siempre.",
    values,
  };
}
