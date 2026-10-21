"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { getStoreContext } from "@/server/auth/store-context";
import { callRpc } from "@/server/db/rpc";
import { sanitizeMerchantHtml } from "@/server/security/sanitize";
import { invalidateStore } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { themeRpcError } from "@/server/theme/errors";

import type { HomeFormState } from "../apariencia/home-actions";
import { normalizeSections, sectionIssues } from "../apariencia/home-normalize";

/**
 * Editor de páginas y menús (F5-T06). La tienda sale de la URL; permisos y
 * destinos los valida la base. El HTML se sanitiza aquí y otra vez al
 * renderizar (SafeHtml).
 */
export interface ContentActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const MESSAGES: Record<string, string> = {
  title: "Escribe un título de hasta 120 caracteres.",
  slug: "Esa dirección ya existe o no es válida (minúsculas, números y guiones).",
  slug_published: "Una página publicada no cambia de dirección. Despublícala primero.",
  body_html: "Escribe el contenido antes de publicar (máximo 100 KB).",
  items: "Revisa el menú: máximo 50 enlaces, dos niveles y un texto en cada uno.",
  target_id: "Uno de los destinos ya no existe. Elige otro.",
  page: "Revisa los datos de la página.",
  seo_image_media_id: "Esa imagen ya no está disponible. Elige otra.",
};

function failure(error: unknown): ContentActionState {
  const appError = reportActionError("content", error);
  if (appError.code === "conflict")
    return { error: "Las políticas no se borran: despublícalas si no las usas." };
  const fields = appError.fields
    ? Object.fromEntries(
        Object.keys(appError.fields).map((k) => [k, MESSAGES[k] ?? "Revisa este dato."]),
      )
    : undefined;
  return { error: appError.message, ...(fields ? { fields } : {}) };
}

async function withStore<T>(
  storeHandle: string,
  work: (input: {
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    storeId: string;
  }) => Promise<T>,
): Promise<T> {
  const ctx = await getStoreContext(storeHandle);
  const supabase = await createSupabaseServerClient();
  const result = await work({ supabase, storeId: ctx.store.id });
  invalidateStore(ctx.store.id);
  return result;
}

const base = (h: string) => `/admin/${h}/contenido`;
const uuid = z.uuid();

export async function savePage(
  storeHandle: string,
  pageId: string | null,
  _: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const keys = ["title", "slug", "body_html", "seo_title", "seo_description", "seo_image_media_id"];
  const values = Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
  if (pageId && !uuid.safeParse(pageId).success) return { error: "Página no válida." };
  let saved: { id: string };
  try {
    saved = await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc<{ id: string }>(supabase, "content_upsert_page", {
        p_store_id: storeId,
        p_page: {
          ...(pageId ? { id: pageId } : {}),
          title: values.title,
          slug: values.slug,
          body_html: sanitizeMerchantHtml(values.body_html),
          seo_title: values.seo_title?.slice(0, 70),
          seo_description: values.seo_description?.slice(0, 320),
          // Solo el formulario que tiene el campo lo manda (la base conserva lo demás).
          ...(formData.has("seo_image_media_id")
            ? { seo_image_media_id: values.seo_image_media_id || null }
            : {}),
        },
      }),
    );
  } catch (error) {
    return { ...failure(error), values };
  }
  revalidatePath(base(storeHandle), "layout");
  if (!pageId) redirect(`${base(storeHandle)}/paginas/${saved.id}?creada=1`);
  return { ok: true, message: "Página guardada." };
}

export async function pageAction(
  storeHandle: string,
  pageId: string,
  _: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const action = String(formData.get("action") ?? "");
  if (!uuid.safeParse(pageId).success || !["publish", "unpublish", "delete"].includes(action)) {
    return { error: "Acción no válida." };
  }
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      action === "delete"
        ? callRpc(supabase, "content_delete_page", { p_store_id: storeId, p_page_id: pageId })
        : callRpc(supabase, "content_set_page_published", {
            p_store_id: storeId,
            p_page_id: pageId,
            p_published: action === "publish",
          }),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath(base(storeHandle), "layout");
  if (action === "delete") redirect(`${base(storeHandle)}?eliminada=1`);
  return { ok: true, message: action === "publish" ? "Página publicada." : "Página despublicada." };
}

const menuItemSchema = z.object({
  label: z.string().trim().min(1).max(60),
  link_type: z.enum(["home", "category", "brand", "product", "page", "search", "url"]),
  target_id: z.uuid().nullable().optional(),
  url: z.string().trim().max(500).nullable().optional(),
});
const menuSchema = z
  .array(menuItemSchema.extend({ children: z.array(menuItemSchema).max(20).default([]) }))
  .max(50);

export async function saveMenu(
  storeHandle: string,
  handle: "main" | "footer",
  _: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    return { error: "No pudimos leer el menú. Recarga la página." };
  }
  const parsed = menuSchema.safeParse(items);
  if (!parsed.success || !["main", "footer"].includes(handle)) {
    return { error: MESSAGES.items! };
  }
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "menu_set_items", {
        p_store_id: storeId,
        p_handle: handle,
        p_items: parsed.data,
      }),
    );
  } catch (error) {
    const state = failure(error);
    return { error: Object.values(state.fields ?? {})[0] ?? state.error };
  }
  revalidatePath(`${base(storeHandle)}/menus`);
  return {
    ok: true,
    message: handle === "main" ? "Menú principal guardado." : "Menú del pie guardado.",
  };
}

// -----------------------------------------------------------------------------
// Bloques de una página (ADR-034 §3): borrador → publicar, como la portada.
// -----------------------------------------------------------------------------
const BLOCK_REFERENCE_MESSAGES: Record<string, string> = {
  image_media_id: "La imagen ya no está disponible. Elige otra.",
  source: "Lo que elegiste para mostrar productos ya no existe o no se puede filtrar.",
  category_ids: "Alguna categoría ya no existe o está oculta.",
  brand_ids: "Alguna marca ya no existe o no tiene logo.",
  value_ids: "Algún objetivo ya no existe o ya no se usa como filtro.",
};

export async function savePageBlocks(
  storeHandle: string,
  pageId: string,
  _: HomeFormState,
  formData: FormData,
): Promise<HomeFormState> {
  if (!uuid.safeParse(pageId).success) return { error: "Página no válida." };
  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("sections") ?? "[]"));
  } catch {
    return { error: "No pudimos leer los bloques. Recarga la página." };
  }
  const sections = normalizeSections(input);
  const issues = sectionIssues(sections);
  if (typeof issues === "string") return { error: issues };
  if (issues) return { error: "Revisa los bloques marcados.", sections: issues };
  try {
    const ctx = await getStoreContext(storeHandle);
    const supabase = await createSupabaseServerClient();
    await callRpc(supabase, "content_save_page_blocks", {
      p_store_id: ctx.store.id,
      p_page_id: pageId,
      p_sections: sections,
    });
  } catch (error) {
    const e = themeRpcError(error);
    if (e.detail === "references") {
      const byId: Record<string, string[]> = {};
      for (const item of e.items) {
        const [id, field] = item.split(":");
        if (id && field)
          (byId[id] ??= []).push(BLOCK_REFERENCE_MESSAGES[field] ?? "Revisa este bloque.");
      }
      return { error: "Algunos bloques usan algo que ya no existe.", sections: byId };
    }
    if (e.detail === "html") return { error: "El texto con formato tiene contenido no permitido." };
    if (e.detail === "policy_blocks") {
      return { error: "Las políticas se escriben como texto; no llevan bloques." };
    }
    return { error: failure(error).error };
  }
  revalidatePath(`${base(storeHandle)}/paginas/${pageId}`);
  return {
    ok: true,
    message: "Bloques guardados en el borrador. Revísalos en la vista previa y publícalos.",
  };
}

export async function pageBlocksAction(
  storeHandle: string,
  pageId: string,
  _: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const action = String(formData.get("action") ?? "");
  if (!uuid.safeParse(pageId).success || !["publish", "discard"].includes(action)) {
    return { error: "Acción no válida." };
  }
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(
        supabase,
        action === "publish" ? "content_publish_page_blocks" : "content_discard_page_blocks",
        { p_store_id: storeId, p_page_id: pageId },
      ),
    );
  } catch (error) {
    const e = themeRpcError(error);
    if (e.detail === "compliance") {
      return {
        error:
          "Algún bloque tiene términos que las reglas sanitarias de tu tienda no permiten. Cámbialos antes de publicar.",
      };
    }
    if (e.detail === "references") {
      return { error: "Algún bloque usa algo que ya no existe. Revisa los bloques marcados." };
    }
    if (e.detail === "no_draft") return { error: "No hay cambios de bloques sin publicar." };
    return failure(error);
  }
  revalidatePath(`${base(storeHandle)}/paginas/${pageId}`);
  return {
    ok: true,
    message:
      action === "publish"
        ? "Bloques publicados. Tus clientes ya los ven si la página está publicada."
        : "Cambios de bloques descartados.",
  };
}
