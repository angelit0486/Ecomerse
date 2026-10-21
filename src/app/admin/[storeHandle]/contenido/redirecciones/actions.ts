"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { callRpc } from "@/server/db/rpc";

import { failureFrom, storeClient, type FormState } from "../../_shared/action-state";

/** Redirecciones 301 (D-EST-02). La base valida rutas, cadenas y límites. */
const MESSAGES: Record<string, string> = {
  from_path:
    "Escribe la dirección vieja empezando con «/», sin dominio. El inicio, el carrito, el pago y tu cuenta no se pueden redirigir.",
  to_path: "Escribe una dirección de tu tienda que empiece con «/» (no otro sitio).",
  chain:
    "Esa dirección ya tiene o es destino de otra redirección. Apunta directo a la página final.",
  too_many: "Llegaste al máximo de 500 redirecciones. Quita las que ya no uses.",
  redirect: "Esa redirección ya no existe.",
};
const failure = failureFrom("redirects", MESSAGES);

/** Acepta lo que suele pegarse: la dirección completa de la tienda. */
function pathOf(raw: string): string {
  const value = raw.trim();
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).pathname;
  } catch {
    return value;
  }
  return value;
}

export async function saveRedirect(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const from = String(formData.get("from_path") ?? "");
  const to = String(formData.get("to_path") ?? "");
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "seo_upsert_redirect", {
      p_store_id: storeId,
      p_from: pathOf(from),
      p_to: to.trim(),
    });
  } catch (error) {
    return failure(error, { from_path: from, to_path: to });
  }
  revalidatePath(`/admin/${storeHandle}/contenido/redirecciones`);
  return { ok: true, message: "Redirección guardada. Se aplica en menos de un minuto." };
}

export async function deleteRedirect(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("redirect_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "seo_delete_redirect", { p_store_id: storeId, p_redirect_id: id });
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/admin/${storeHandle}/contenido/redirecciones`);
  // La fila desaparece con su botón: el aviso va en la página.
  redirect(`/admin/${encodeURIComponent(storeHandle)}/contenido/redirecciones?quitada=1`);
}
