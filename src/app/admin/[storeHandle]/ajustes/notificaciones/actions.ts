"use server";

import { revalidatePath } from "next/cache";

import { callRpc } from "@/server/db/rpc";

import { failureFrom, formValues, storeClient, type FormState } from "../../_shared/action-state";

const failure = failureFrom("notifications", {
  staff_emails: "Escribe hasta 5 emails válidos, uno por línea.",
});

export async function saveNotifications(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const emails = String(formData.get("staff_emails") ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const values = formValues(formData, ["staff_emails"]);
  if (emails.length > 5) {
    const message = "Escribe hasta 5 emails válidos, uno por línea.";
    return { error: message, fields: { staff_emails: message }, values };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "notifications_update", {
      p_store_id: storeId,
      p_staff_emails: emails,
      p_notify_new_order: formData.get("notify_new_order") === "1",
      p_notify_paid: formData.get("notify_paid") === "1",
    });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(`/admin/${storeHandle}/ajustes/notificaciones`);
  return { ok: true, message: "Notificaciones guardadas." };
}
