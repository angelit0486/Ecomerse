"use server";

import { revalidatePath } from "next/cache";

import { formValues } from "@/lib/form-values";
import { COLOR_KEYS } from "@/lib/theme/palette";
import { getStoreContext } from "@/server/auth/store-context";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";
import { invalidateStore } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Onboarding, paso 2 (GATE0 §20.2): datos de la tienda y branding en borrador. */
export interface StepState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const FIELD_MESSAGES: Record<string, string> = {
  name: "Escribe un nombre de 2 a 80 caracteres.",
  contact_email: "Escribe un email válido.",
  contact_phone: "Escribe un teléfono válido (solo números, espacios, +, - y paréntesis).",
  timezone: "Elige una zona horaria.",
};

function failure(error: unknown, messages: Record<string, string> = {}): StepState {
  const appError = reportActionError("onboarding", error);
  const fields = appError.fields
    ? Object.fromEntries(
        Object.keys(appError.fields).map((k) => [k, messages[k] ?? "Revisa este dato."]),
      )
    : undefined;
  return { error: appError.message, ...(fields ? { fields } : {}) };
}

export async function saveStoreProfile(
  storeHandle: string,
  _: StepState,
  formData: FormData,
): Promise<StepState> {
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "store_update_profile", {
      p_store_id: ctx.store.id,
      p_name: String(formData.get("name") ?? ""),
      p_contact_email: String(formData.get("contact_email") ?? ""),
      p_contact_phone: String(formData.get("contact_phone") ?? ""),
      p_timezone: String(formData.get("timezone") ?? ""),
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    return {
      ...failure(error, FIELD_MESSAGES),
      values: formValues(formData, ["name", "contact_email", "contact_phone", "timezone"]),
    };
  }
  revalidatePath(`/admin/${storeHandle}`, "layout");
  return { ok: true, message: "Datos de la tienda guardados." };
}

export async function saveBranding(
  storeHandle: string,
  _: StepState,
  formData: FormData,
): Promise<StepState> {
  const colors: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    const value = String(formData.get(key) ?? "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) return { error: "Elige colores válidos." };
    colors[key] = value;
  }
  const radius = String(formData.get("radius") ?? "md");
  const buttonStyle = String(formData.get("button_style") ?? "solid");
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "appearance_save_theme_draft", {
      p_store_id: ctx.store.id,
      p_settings: { colors, shape: { radius, button_style: buttonStyle } },
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    const result = failure(error);
    if (result.fields?.contrast) {
      return { error: "El contraste de los colores no es suficiente. Ajusta los marcados." };
    }
    return result;
  }
  revalidatePath(`/admin/${storeHandle}/configuracion`);
  return { ok: true, message: "Branding guardado en borrador." };
}

// -----------------------------------------------------------------------------
// Logo (F3-T06): mismo pipeline que las imágenes del catálogo (§25.3), máx. 2 MB.
// -----------------------------------------------------------------------------
const LOGO_ERROR = "Usa una imagen JPG, PNG, WebP o AVIF de hasta 2 MB.";

export async function requestLogoUpload(
  storeHandle: string,
  input: { mimeType: string; bytes: number },
): Promise<{ ok: true; mediaId: string; signedUrl: string } | { ok: false; error: string }> {
  if (typeof input?.mimeType !== "string" || !Number.isInteger(input?.bytes) || input.bytes < 1) {
    return { ok: false, error: LOGO_ERROR };
  }
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    const ticket = await createMediaUpload(supabase, {
      storeId: ctx.store.id,
      ownerType: "store_branding",
      productId: null,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    return { ok: true, mediaId: ticket.mediaId, signedUrl: ticket.signedUrl };
  } catch (error) {
    const result = failure(error);
    return { ok: false, error: result.fields ? LOGO_ERROR : (result.error ?? LOGO_ERROR) };
  }
}

export async function finalizeLogoUpload(
  storeHandle: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) return { ok: false, error: "Subida no válida." };
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await finalizeMediaUpload(supabase, ctx.store.id, mediaId);
  } catch (error) {
    return { ok: false, error: failure(error).error };
  }
  revalidatePath(`/admin/${storeHandle}/configuracion`);
  return { ok: true };
}

/** Usa (o quita) un logo ya procesado en el borrador del branding. */
export async function setLogoDraft(
  storeHandle: string,
  _: StepState,
  formData: FormData,
): Promise<StepState> {
  const mediaId = String(formData.get("media_id") ?? "");
  if (mediaId && !/^[0-9a-f-]{36}$/.test(mediaId)) return { error: "Logo no válido." };
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "appearance_set_logo_draft", {
      p_store_id: ctx.store.id,
      p_media_id: mediaId || null,
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    const result = failure(error);
    return result.fields?.logo ? { error: "Ese logo aún no está listo o no es válido." } : result;
  }
  revalidatePath(`/admin/${storeHandle}/configuracion`);
  return {
    ok: true,
    message: mediaId ? "Logo guardado en el borrador." : "Logo quitado del borrador.",
  };
}
