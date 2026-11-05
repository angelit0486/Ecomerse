"use server";

import { revalidatePath } from "next/cache";

import { STORE_FEATURES } from "@/lib/features/store-features";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";

import { storeClient, type FormState } from "../../_shared/action-state";

/** Enciende o apaga una función en esta tienda (la base valida permiso y lista). */
export async function setStoreFeature(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const key = String(formData.get("key") ?? "");
  const enabled = formData.get("enabled") === "1";
  const copy = STORE_FEATURES[key];
  if (!copy) return { error: "Esa función no existe." };
  let now: boolean;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    now = await callRpc<boolean>(supabase, "store_set_feature", {
      p_store_id: storeId,
      p_key: key,
      p_enabled: enabled,
    });
  } catch (error) {
    const e = reportActionError("features", error);
    // Apagada por la plataforma (kill switch) o con una excepción suya para esta tienda.
    if (e.code === "conflict") {
      return {
        error:
          "La plataforma administra esta función por ahora. Si necesitas cambiarla, escríbenos.",
      };
    }
    return { error: e.message };
  }
  revalidatePath(`/admin/${storeHandle}`, "layout");
  return { ok: true, message: `${copy.title}: ${now ? "encendida" : "apagada"}.` };
}
