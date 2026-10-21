"use server";

import { revalidatePath } from "next/cache";

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@/lib/media/constants";
import { brokenLinkHint, sectionLinks } from "@/lib/theme/link-targets";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";
import { themeRpcError } from "@/server/theme/errors";

import { storeClient } from "../_shared/action-state";
import { normalizeSections, sectionIssues } from "./home-normalize";
import { loadLinkTargets } from "./home-options";

/**
 * Portada (F9-T02, F9-DESIGN §3 y §7): se guarda la lista completa de secciones
 * en el borrador. La app normaliza y sanitiza; la base vuelve a validar todo.
 */
export interface HomeFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Errores por sección (id de la sección → mensajes). */
  sections?: Record<string, string[]>;
  /** Avisos que no impiden guardar, p. ej. un enlace a una página que no existe. */
  warnings?: Record<string, string[]>;
}

const CONFLICT =
  "Otra persona cambió la apariencia mientras tanto. Recarga la página para ver sus cambios antes de continuar.";

const REFERENCE_MESSAGES: Record<string, string> = {
  image_media_id: "La imagen ya no está disponible. Elige otra.",
  source: "Lo que elegiste para mostrar productos ya no existe o no se puede filtrar.",
  category_ids: "Alguna categoría ya no existe o está oculta.",
  brand_ids: "Alguna marca ya no existe o no tiene logo.",
  value_ids: "Algún objetivo ya no existe o ya no se usa como filtro.",
};

export async function saveHomeDraft(
  storeHandle: string,
  _: HomeFormState,
  formData: FormData,
): Promise<HomeFormState> {
  const rawRevision = String(formData.get("revision") ?? "");
  if (!/^\d{1,9}$/.test(rawRevision)) return { error: "Recarga la página e inténtalo de nuevo." };
  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("sections") ?? "[]"));
  } catch {
    return { error: "No pudimos leer las secciones. Recarga la página." };
  }
  const sections = normalizeSections(input);
  const issues = sectionIssues(sections);
  if (typeof issues === "string") return { error: issues };
  if (issues) return { error: "Revisa las secciones marcadas.", sections: issues };
  let storeId = "";
  try {
    const client = await storeClient(storeHandle);
    storeId = client.storeId;
    await callRpc(client.supabase, "appearance_save_home_draft", {
      p_store_id: storeId,
      p_sections: sections,
      p_expected_revision: Number(rawRevision),
    });
  } catch (error) {
    const e = themeRpcError(error);
    if (e.code === "conflict") return { error: CONFLICT };
    if (e.detail === "references") {
      const byId: Record<string, string[]> = {};
      for (const item of e.items) {
        const [id, field] = item.split(":");
        if (id && field)
          (byId[id] ??= []).push(REFERENCE_MESSAGES[field] ?? "Revisa esta sección.");
      }
      return { error: "Algunas secciones usan algo que ya no existe.", sections: byId };
    }
    if (e.detail === "html") {
      return { error: "El texto con formato tiene contenido no permitido." };
    }
    if (e.code === "forbidden") return { error: "Tu rol no permite cambiar la apariencia." };
    reportActionError("appearance.home", error);
    return { error: "No pudimos guardar la portada. Inténtalo de nuevo." };
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  const warnings = await linkWarnings(storeId, sections);
  return {
    ok: true,
    message: warnings
      ? "Portada guardada en el borrador, pero revisa los avisos: hay botones que llevan a páginas que no existen."
      : "Portada guardada en el borrador. Revísala en la vista previa y publícala.",
    ...(warnings ? { warnings } : {}),
  };
}

/** Enlaces a páginas que no existen (DIAGNOSTICO-PORTADA R3): avisan, no bloquean. */
async function linkWarnings(
  storeId: string,
  sections: unknown,
): Promise<Record<string, string[]> | undefined> {
  if (!Array.isArray(sections)) return undefined;
  try {
    const targets = await loadLinkTargets(storeId);
    const out: Record<string, string[]> = {};
    for (const section of sections as { id: string; props?: unknown }[]) {
      for (const link of sectionLinks(section.props)) {
        const hint = brokenLinkHint(link, targets);
        if (hint) (out[section.id] ??= []).push(hint);
      }
    }
    return Object.keys(out).length ? out : undefined;
  } catch (error) {
    reportActionError("appearance.home.links", error);
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Imágenes de la portada (banners): mismo pipeline seguro de medios (§25.3).
// -----------------------------------------------------------------------------
const BANNER_ERROR = "Usa una imagen JPG, PNG, WebP o AVIF de hasta 10 MB.";

export async function requestBannerUpload(
  storeHandle: string,
  input: { mimeType: string; bytes: number },
): Promise<{ ok: true; mediaId: string; signedUrl: string } | { ok: false; error: string }> {
  if (
    !(ALLOWED_IMAGE_MIME as readonly string[]).includes(input?.mimeType) ||
    !Number.isInteger(input?.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_UPLOAD_BYTES
  ) {
    return { ok: false, error: BANNER_ERROR };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const ticket = await createMediaUpload(supabase, {
      storeId,
      ownerType: "banner",
      productId: null,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });
    return { ok: true, mediaId: ticket.mediaId, signedUrl: ticket.signedUrl };
  } catch (error) {
    const e = reportActionError("appearance.banner", error);
    if (e.code === "forbidden") {
      return { ok: false, error: "Tu rol no permite subir imágenes de contenido." };
    }
    return { ok: false, error: e.fields ? BANNER_ERROR : e.message };
  }
}

export async function finalizeBannerUpload(
  storeHandle: string,
  mediaId: string,
  altText: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(mediaId)) return { ok: false, error: "Subida no válida." };
  const alt = altText.replace(/\s+/g, " ").trim().slice(0, 250);
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await finalizeMediaUpload(supabase, storeId, mediaId);
    if (alt) {
      await callRpc(supabase, "media_set_alt_text", {
        p_store_id: storeId,
        p_media_id: mediaId,
        p_alt_text: alt,
      });
    }
  } catch (error) {
    return { ok: false, error: reportActionError("appearance.banner", error).message };
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return { ok: true };
}
