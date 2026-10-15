"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import { invalidateStore } from "@/server/storefront/cache";
import { themeRpcError } from "@/server/theme/errors";

import { storeClient, type FormState } from "../_shared/action-state";
import { sectionPatch, THEME_SECTIONS, validatePatch, type ThemeSection } from "./patch";

/**
 * Apariencia (F9-T01, F9-DESIGN §7): guardar una pestaña en el borrador,
 * publicar y descartar. Toda llamada lleva la revisión que tenía la página
 * (§13 H1); la base vuelve a validar todo.
 */
const CONFLICT =
  "Otra persona cambió la apariencia mientras tanto. Recarga la página para ver sus cambios antes de continuar.";

const CONTRAST: Record<string, string> = {
  foreground: "El texto no se lee bien sobre el fondo.",
  muted: "El texto secundario no se lee bien sobre el fondo.",
  primary: "El color principal no se distingue del fondo (con botones de contorno exige 4.5:1).",
  accent: "El acento no se distingue del fondo.",
  announcement: "El texto de la barra de anuncio no se lee bien sobre su fondo.",
};

const CONTRAST_FIELD: Record<string, string> = {
  foreground: "foreground",
  muted: "muted",
  primary: "primary",
  accent: "accent",
  announcement: "announcement_foreground",
};

function readRevision(formData: FormData): number | null {
  const raw = String(formData.get("revision") ?? "");
  return /^\d{1,9}$/.test(raw) ? Number(raw) : null;
}

/** Mensajes de los bloqueos de la base (contraste, referencias, cumplimiento). */
function rpcFailure(error: unknown): FormState {
  const e = themeRpcError(error);
  if (e.code === "conflict") return { error: CONFLICT };
  if (e.code === "internal") reportActionError("appearance", error);
  if (e.detail === "contrast") {
    const fields = Object.fromEntries(
      e.items.filter((k) => CONTRAST[k]).map((k) => [CONTRAST_FIELD[k]!, CONTRAST[k]!]),
    );
    return { error: "Ajusta los colores marcados: el contraste no es suficiente.", fields };
  }
  if (e.detail === "references") {
    const seo = e.items.includes("seo.image_media_id");
    const logo = e.items.includes("logo");
    const sections = e.items.filter((i) => i.includes(":")).length;
    const parts = [
      seo ? "la imagen social ya no está disponible" : null,
      logo ? "el logo ya no está disponible" : null,
      sections
        ? `${sections === 1 ? "una sección" : `${sections} secciones`} de la portada usa${sections === 1 ? "" : "n"} algo que ya no existe o no se puede mostrar`
        : null,
    ].filter(Boolean);
    return {
      error: `No se puede guardar: ${parts.join("; ") || "una referencia ya no existe"}. Elige otra opción.`,
      ...(seo ? { fields: { seo_image_media_id: "Elige otra imagen." } } : {}),
    };
  }
  if (e.detail === "compliance") {
    const n = e.items.length;
    return {
      error: `La portada tiene ${n === 1 ? "un texto" : `${n} textos`} con términos que las reglas sanitarias de tu tienda no permiten. Cámbialos en la pestaña Portada antes de publicar.`,
    };
  }
  if (e.detail === "no_draft") return { error: "No hay cambios sin publicar." };
  if (e.detail === "settings" || e.detail === "sections") {
    return { error: "Algún dato no es válido. Revisa los campos y vuelve a intentarlo." };
  }
  if (e.code === "forbidden") return { error: "Tu rol no permite cambiar la apariencia." };
  return { error: "No pudimos guardar. Inténtalo de nuevo." };
}

export async function saveThemeSection(
  storeHandle: string,
  section: ThemeSection,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(THEME_SECTIONS as readonly string[]).includes(section))
    return { error: "Sección no válida." };
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  const result = validatePatch(
    sectionPatch(
      section,
      (k) => String(formData.get(k) ?? ""),
      (k) => formData.getAll(k).map(String),
    ),
  );
  if (!result.ok) {
    return { error: "Revisa los campos marcados.", fields: result.fields };
  }
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "appearance_save_theme_draft", {
      p_store_id: storeId,
      p_patch: result.patch,
      p_expected_revision: revision,
    });
  } catch (error) {
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return { ok: true, message: "Guardado en el borrador. Revísalo en la vista previa y publícalo." };
}

export async function publishTheme(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "appearance_publish_theme", {
      p_store_id: storeId,
      p_expected_revision: revision,
    });
    // La tienda pública cambia al instante (§21.4).
    invalidateStore(storeId);
  } catch (error) {
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return { ok: true, message: "Publicado. Tus clientes ya ven la nueva apariencia." };
}

export async function discardThemeDraft(
  storeHandle: string,
  section: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get("confirm") !== "1") {
    return { error: "Marca la casilla para confirmar que quieres descartar los cambios." };
  }
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "appearance_discard_draft", {
      p_store_id: storeId,
      p_expected_revision: revision,
    });
  } catch (error) {
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  // Los formularios se rehacen con lo publicado (la página los monta con otra clave).
  const tab = /^[a-z]{1,20}$/.test(section) ? section : "marca";
  redirect(`/admin/${storeHandle}/apariencia?seccion=${tab}&descartado=${revision + 1}`);
}
