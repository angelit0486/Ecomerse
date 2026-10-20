"use server";

import { revalidatePath } from "next/cache";

import { formValues } from "@/lib/form-values";
import { hasPermission } from "@/server/auth/context";
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
  code?: string;
}

const FIELD_MESSAGES: Record<string, string> = {
  name: "Escribe un nombre de 2 a 80 caracteres.",
  contact_email: "Escribe un email válido.",
  contact_phone: "Escribe un teléfono válido (solo números, espacios, +, - y paréntesis).",
  timezone: "Elige una zona horaria.",
};

const CONFLICT_MESSAGE =
  "Otra persona cambió la apariencia mientras tanto. Recarga la página para ver sus cambios.";

/** Revisión del borrador que tenía la página al abrirse (F9-DESIGN §13 H1). */
function readRevision(formData: FormData): number | null {
  const raw = String(formData.get("revision") ?? "");
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

function failure(error: unknown, messages: Record<string, string> = {}): StepState {
  const appError = reportActionError("onboarding", error);
  const fields = appError.fields
    ? Object.fromEntries(
        Object.keys(appError.fields).map((k) => [k, messages[k] ?? "Revisa este dato."]),
      )
    : undefined;
  return { error: appError.message, code: appError.code, ...(fields ? { fields } : {}) };
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
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "appearance_set_logo_draft", {
      p_store_id: ctx.store.id,
      p_media_id: mediaId || null,
      p_expected_revision: revision,
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    const result = failure(error);
    if (result.code === "conflict") return { error: CONFLICT_MESSAGE };
    return result.fields?.logo ? { error: "Ese logo aún no está listo o no es válido." } : result;
  }
  revalidatePath(`/admin/${storeHandle}/configuracion`);
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return {
    ok: true,
    message: mediaId ? "Logo guardado en el borrador." : "Logo quitado del borrador.",
  };
}

// -----------------------------------------------------------------------------
// Pasos 3 y 4 (F7-T05, A-02): pago manual y publicación con validación.
// -----------------------------------------------------------------------------
const PAYMENT_MESSAGES: Record<string, string> = {
  display_name: "Escribe un nombre de 1 a 80 caracteres.",
  instructions: "Escribe instrucciones de 10 a 2000 caracteres (banco, CLABE, titular).",
};

export async function saveManualPayment(
  storeHandle: string,
  _: StepState,
  formData: FormData,
): Promise<StepState> {
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "payments_save_manual", {
      p_store_id: ctx.store.id,
      p_display_name: String(formData.get("display_name") ?? ""),
      p_instructions: String(formData.get("instructions") ?? ""),
      p_active: formData.get("active") === "1",
    });
    invalidateStore(ctx.store.id);
  } catch (error) {
    const result = failure(error, PAYMENT_MESSAGES);
    return {
      ...result,
      error: (result.fields && Object.values(result.fields)[0]) || result.error,
      values: formValues(formData, ["display_name", "instructions", "active"]),
    };
  }
  revalidatePath(`/admin/${storeHandle}/configuracion`);
  revalidatePath(`/admin/${storeHandle}/ajustes/pagos`);
  return { ok: true, message: "Pago por transferencia guardado." };
}

export async function launchStore(storeHandle: string, _: StepState): Promise<StepState> {
  let brandingNote = "";
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    const { data: before } = await supabase
      .from("stores")
      .select("launched_at")
      .eq("id", ctx.store.id)
      .maybeSingle();
    try {
      await callRpc(supabase, "stores_launch", { p_store_id: ctx.store.id });
    } catch (error) {
      const result = failure(error);
      if (!result.fields) return { error: result.error };
      // Se dice qué falta (antes solo «aún hay pendientes»).
      const { data: checklist } = await supabase.rpc("stores_launch_checklist", {
        p_store_id: ctx.store.id,
      });
      const pending = ((checklist as { issues?: { message: string }[] } | null)?.issues ?? [])
        .map((i) => i.message)
        .join("; ");
      return {
        error: pending
          ? `Antes de publicar falta: ${pending}.`
          : "Aún hay pendientes en la lista. Complétalos y vuelve a intentarlo.",
      };
    }
    // Primera publicación: la marca elegida en este asistente (guardada en el
    // borrador del tema) sale con la tienda; antes quedaba en borrador (auditoría
    // del panel, fallo 1). Un relanzamiento tras pausar no toca la apariencia.
    // Solo con la lectura confirmada: si fallara, no se publica la marca (un
    // relanzamiento tras pausar no debe tocar la apariencia).
    if (before && !before.launched_at && hasPermission(ctx, "appearance.manage")) {
      const { data: theme } = await supabase
        .from("store_themes")
        .select("draft_settings, draft_revision")
        .eq("store_id", ctx.store.id)
        .maybeSingle();
      if (theme?.draft_settings) {
        try {
          await callRpc(supabase, "appearance_publish_theme", {
            p_store_id: ctx.store.id,
            p_expected_revision: theme.draft_revision,
          });
        } catch (error) {
          failure(error);
          brandingNote =
            " Tu marca no se pudo publicar con ella: revísala y publícala en Apariencia.";
        }
      }
    }
    invalidateStore(ctx.store.id);
  } catch (error) {
    return { error: failure(error).error };
  }
  revalidatePath(`/admin/${storeHandle}`, "layout");
  return { ok: true, message: `¡Tu tienda está publicada!${brandingNote}` };
}
