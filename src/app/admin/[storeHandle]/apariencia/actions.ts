"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  MAX_THEME_FILE_BYTES,
  parseThemeFile,
  portableDesign,
  type PortableDesign,
} from "@/lib/theme/portable";
import { HomeSectionsV2, ThemeSettingsV2 } from "@/lib/theme/schema";
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
  sale: "El color de oferta no se lee sobre el fondo (necesita 4.5:1).",
};

const CONTRAST_FIELD: Record<string, string> = {
  foreground: "foreground",
  muted: "muted",
  primary: "primary",
  accent: "accent",
  announcement: "announcement_foreground",
  sale: "sale",
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
      e.items.flatMap((k): [string, string][] => {
        if (CONTRAST[k]) return [[CONTRAST_FIELD[k]!, CONTRAST[k]!]];
        // Tema v4: «element_colors.<elemento>» o «element_colors.nav_bar.active».
        const [, element, part] = k.split(".");
        if (k.startsWith("element_colors.") && element) {
          return part === "active"
            ? [["el_nav_bar_active", "El color del elemento activo no se lee sobre el fondo."]]
            : [[`el_${element}_fg`, "Este texto no se lee sobre su fondo (necesita 4.5:1)."]];
        }
        return [];
      }),
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
  // El mismo formulario de marca vive en «Configurar tienda» (su paso cuenta como hecho).
  revalidatePath(`/admin/${storeHandle}/configuracion`);
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

/**
 * «Deshacer la última publicación» (misión Portada/Marcas, Paso 3): copia la
 * versión anterior del historial al borrador y la publica. Son las mismas dos
 * RPC que «Restaurar» + «Publicar», con la revisión encadenada; si otra persona
 * cambió el borrador en medio, la publicación se rechaza y nada se pierde.
 */
export async function undoPublish(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const versionId = String(formData.get("version_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return { error: "Versión no válida." };
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  let version: number;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    const restored = await callRpc<{ revision: number; version: number }>(
      supabase,
      "appearance_restore_theme_version",
      { p_store_id: storeId, p_version_id: versionId, p_expected_revision: revision },
    );
    version = restored.version;
    await callRpc(supabase, "appearance_publish_theme", {
      p_store_id: storeId,
      p_expected_revision: restored.revision,
    });
    invalidateStore(storeId);
  } catch (error) {
    const e = themeRpcError(error);
    if (e.detail === "references") {
      return {
        error:
          "La versión anterior usa imágenes, productos o categorías que ya no existen. Elige otra en Historial.",
      };
    }
    if (e.code === "not_found") return { error: "Esa versión ya no está en el historial." };
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return { ok: true, message: `Listo: volviste a la versión ${version}. Tus clientes ya la ven.` };
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

/**
 * Historial (ADR-034 §4): copia una versión publicada al borrador. No publica:
 * la dueña la revisa en la vista previa y publica como siempre.
 */
export async function restoreThemeVersion(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const versionId = String(formData.get("version_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return { error: "Versión no válida." };
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  let result: { version: number; logo_missing: boolean };
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    result = await callRpc(supabase, "appearance_restore_theme_version", {
      p_store_id: storeId,
      p_version_id: versionId,
      p_expected_revision: revision,
    });
  } catch (error) {
    const e = themeRpcError(error);
    if (e.detail === "references") {
      return {
        error:
          "Esa versión usa imágenes, productos o categorías que ya no existen. Restaura otra o arma el diseño de nuevo.",
      };
    }
    if (e.code === "not_found") return { error: "Esa versión ya no está en el historial." };
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return {
    ok: true,
    message: `Versión ${result.version} copiada al borrador${result.logo_missing ? " (su logo ya no existe: elige uno en Marca)" : ""}. Revísala en la vista previa y publícala.`,
  };
}

// -----------------------------------------------------------------------------
// Mover el diseño (ADR-034 §6): importar un archivo exportado o copiar el diseño
// publicado de otra tienda de la misma organización. Siempre al borrador.
// -----------------------------------------------------------------------------
async function importDesign(
  storeHandle: string,
  design: PortableDesign,
  revision: number,
  source: string,
): Promise<FormState | null> {
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    await callRpc(supabase, "appearance_import_design", {
      p_store_id: storeId,
      p_settings: design.settings,
      p_sections: design.home_sections,
      p_expected_revision: revision,
      p_source: source,
    });
  } catch (error) {
    return rpcFailure(error);
  }
  revalidatePath(`/admin/${storeHandle}/apariencia`);
  return null;
}

const MOVED =
  "Diseño copiado al borrador. Las imágenes y las secciones que dependían de productos, categorías o marcas de la otra tienda no se copian: revísalo en la vista previa y publícalo.";

export async function importDesignFile(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Elige el archivo del diseño." };
  if (file.size > MAX_THEME_FILE_BYTES) return { error: "El archivo es demasiado grande." };
  const parsed = parseThemeFile(await file.text());
  if (!parsed.ok) return { error: parsed.error };
  const failed = await importDesign(storeHandle, parsed.design, revision, "file");
  return failed ?? { ok: true, message: MOVED };
}

export async function copyDesignFromStore(
  storeHandle: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const revision = readRevision(formData);
  if (revision === null) return { error: "Recarga la página e inténtalo de nuevo." };
  const sourceId = String(formData.get("source_store_id") ?? "");
  let design: PortableDesign;
  try {
    const { supabase, storeId } = await storeClient(storeHandle);
    // Solo tiendas de la MISMA organización a las que esta persona tiene acceso.
    const stores = await callRpc<{ store_id: string; organization_id: string }[]>(
      supabase,
      "access_list_my_stores",
    );
    const target = stores.find((s) => s.store_id === storeId);
    const source = stores.find((s) => s.store_id === sourceId);
    if (
      !target ||
      !source ||
      source.organization_id !== target.organization_id ||
      sourceId === storeId
    ) {
      return { error: "Elige otra tienda de tu organización." };
    }
    const { data: theme, error } = await supabase
      .from("store_themes")
      .select("settings, home_sections")
      .eq("store_id", sourceId)
      .maybeSingle();
    if (error) throw error;
    const settings = ThemeSettingsV2.safeParse(theme?.settings ?? {});
    const sections = HomeSectionsV2.safeParse(theme?.home_sections ?? []);
    if (!theme || !settings.success || !sections.success) {
      return { error: "Esa tienda todavía no tiene un diseño publicado." };
    }
    design = portableDesign(settings.data, sections.data);
  } catch (error) {
    return rpcFailure(error);
  }
  const failed = await importDesign(storeHandle, design, revision, `store:${sourceId}`);
  return failed ?? { ok: true, message: MOVED };
}
