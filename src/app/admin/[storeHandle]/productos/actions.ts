"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { reportActionError } from "@/server/actions/report";
import { getStoreContext } from "@/server/auth/store-context";
import { productInputSchema } from "@/server/catalog/product-input";
import { validateProduct } from "@/server/catalog/queries";
import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";
import { createMediaUpload, finalizeMediaUpload } from "@/server/media/upload";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { FIELD_MESSAGES, PUBLISH_ISSUES } from "./messages";

/**
 * Acciones del catálogo (F3-T05). La tienda sale siempre de la URL y se vuelve
 * a resolver en cada acción; la autorización y las invariantes las aplican las
 * RPC (la base es la autoridad, §44.8). Los errores vuelven como mensajes.
 */
export interface CatalogActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  issues?: string[];
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const uuid = z.uuid();

async function withStore<T>(
  storeHandle: string,
  work: (input: { supabase: Supabase; storeId: string }) => Promise<T>,
): Promise<T> {
  const ctx = await getStoreContext(storeHandle);
  const supabase = await createSupabaseServerClient();
  return work({ supabase, storeId: ctx.store.id });
}

function failure(scope: string, error: unknown): CatalogActionState {
  const appError = reportActionError(scope, error);
  const fields = appError.fields
    ? Object.fromEntries(
        Object.keys(appError.fields).map((key) => [
          key,
          FIELD_MESSAGES[key] ?? "Revisa este dato.",
        ]),
      )
    : undefined;
  return { error: appError.message, ...(fields ? { fields } : {}) };
}

function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    const root = String(issue.path[0] ?? "product");
    const leaf = String(issue.path.at(-1) ?? root);
    fields[key || "product"] ??=
      leaf === "compare_at_price"
        ? "Debe ser mayor que el precio."
        : leaf === "price"
          ? "Escribe un precio válido."
          : (FIELD_MESSAGES[leaf] ?? FIELD_MESSAGES[root] ?? "Revisa este dato.");
  }
  return fields;
}

const productsPath = (storeHandle: string) => `/admin/${storeHandle}/productos`;

// -----------------------------------------------------------------------------
// Producto
// -----------------------------------------------------------------------------
export async function saveProduct(
  storeHandle: string,
  productId: string | null,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "No pudimos leer el formulario. Recarga la página." };
  }
  const parsed = productInputSchema.safeParse({ ...(raw as object), id: productId ?? undefined });
  if (!parsed.success)
    return { error: "Revisa los datos marcados.", fields: zodFields(parsed.error) };

  let saved: { id: string; slug: string };
  try {
    saved = await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc<{ id: string; slug: string }>(supabase, "catalog_upsert_product", {
        p_store_id: storeId,
        p_product: parsed.data,
      }),
    );
  } catch (error) {
    return failure("catalog.save", error);
  }
  revalidatePath(productsPath(storeHandle));
  if (!productId) redirect(`${productsPath(storeHandle)}/${saved.id}?creado=1`);
  return { ok: true, message: "Cambios guardados." };
}

const STATUS_ACTIONS = ["publish", "draft", "archive", "delete", "restore", "duplicate"] as const;
type StatusAction = (typeof STATUS_ACTIONS)[number];

const STATUS_MESSAGES: Record<StatusAction, string> = {
  publish: "Producto publicado: ya es visible en la tienda.",
  draft: "Producto despublicado: ahora es un borrador.",
  archive: "Producto archivado.",
  delete: "Producto eliminado. Puedes restaurarlo desde «Eliminados».",
  restore: "Producto restaurado como borrador.",
  duplicate: "Copia creada como borrador.",
};

async function applyStatus(
  supabase: Supabase,
  storeId: string,
  productId: string,
  action: StatusAction,
) {
  const args = { p_store_id: storeId, p_product_id: productId };
  switch (action) {
    case "publish":
      return callRpc(supabase, "catalog_publish_product", args);
    case "draft":
      return callRpc(supabase, "catalog_set_product_status", { ...args, p_status: "draft" });
    case "archive":
      return callRpc(supabase, "catalog_set_product_status", { ...args, p_status: "archived" });
    case "delete":
      return callRpc(supabase, "catalog_soft_delete_product", args);
    case "restore":
      return callRpc(supabase, "catalog_restore_product", args);
    case "duplicate":
      return callRpc<{ id: string }>(supabase, "catalog_duplicate_product", args);
  }
}

export async function productStatusAction(
  storeHandle: string,
  productId: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const action = String(formData.get("action") ?? "") as StatusAction;
  if (!STATUS_ACTIONS.includes(action) || !uuid.safeParse(productId).success) {
    return { error: "Acción no válida." };
  }
  let duplicated: string | null = null;
  try {
    await withStore(storeHandle, async ({ supabase, storeId }) => {
      if (action === "publish") {
        const issues = await validateProduct(supabase, storeId, productId);
        const errors = issues.filter((i) => i.level === "error");
        if (errors.length > 0) {
          throw new PublishBlocked(errors.map((i) => PUBLISH_ISSUES[i.code] ?? i.code));
        }
      }
      const result = await applyStatus(supabase, storeId, productId, action);
      if (action === "duplicate") duplicated = (result as { id: string }).id;
    });
  } catch (error) {
    if (error instanceof PublishBlocked) {
      return { error: "Aún no se puede publicar:", issues: error.issues };
    }
    if (action === "restore" && error instanceof AppError && error.fields?.slug) {
      return {
        error:
          "Otro producto usa ya su dirección. Cambia la dirección de ese producto y reintenta.",
      };
    }
    return failure("catalog.status", error);
  }
  revalidatePath(productsPath(storeHandle));
  if (duplicated) redirect(`${productsPath(storeHandle)}/${duplicated}?copiado=1`);
  if (action === "delete") redirect(`${productsPath(storeHandle)}?eliminado=1`);
  return { ok: true, message: STATUS_MESSAGES[action] };
}

class PublishBlocked extends Error {
  constructor(readonly issues: string[]) {
    super("publish_blocked");
  }
}

const BULK_ACTIONS = ["draft", "archive", "delete"] as const;

/** Acciones masivas del listado: cada producto pasa por la misma RPC y permisos. */
export async function bulkProductsAction(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const action = String(formData.get("action") ?? "");
  const ids = formData.getAll("ids").map(String);
  if (!(BULK_ACTIONS as readonly string[]).includes(action)) return { error: "Elige una acción." };
  if (ids.length === 0) return { error: "Selecciona al menos un producto." };
  if (ids.length > 100 || !ids.every((id) => uuid.safeParse(id).success)) {
    return { error: "Selección no válida." };
  }
  let done = 0;
  try {
    await withStore(storeHandle, async ({ supabase, storeId }) => {
      for (const id of ids) {
        await applyStatus(supabase, storeId, id, action as StatusAction);
        done += 1;
      }
    });
  } catch (error) {
    const state = failure("catalog.bulk", error);
    revalidatePath(productsPath(storeHandle));
    return { ...state, error: `${state.error} Se aplicó a ${done} de ${ids.length}.` };
  }
  revalidatePath(productsPath(storeHandle));
  const one = done === 1;
  const verb = {
    draft: one ? "producto pasó a borrador" : "productos pasaron a borrador",
    archive: one ? "producto archivado" : "productos archivados",
    delete: one ? "producto eliminado" : "productos eliminados",
  }[action as (typeof BULK_ACTIONS)[number]];
  return { ok: true, message: `${done} ${verb}.` };
}

// -----------------------------------------------------------------------------
// Imágenes (§25.3): reservar → PUT directo del navegador → finalizar.
// -----------------------------------------------------------------------------
const uploadSchema = z.object({
  productId: z.uuid(),
  mimeType: z.string().max(100),
  bytes: z.number().int().min(1),
});

export type UploadTicketResult =
  { ok: true; mediaId: string; signedUrl: string } | { ok: false; error: string };

export async function requestProductImageUpload(
  storeHandle: string,
  input: { productId: string; mimeType: string; bytes: number },
): Promise<UploadTicketResult> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FIELD_MESSAGES.file! };
  try {
    const ticket = await withStore(storeHandle, ({ supabase, storeId }) =>
      createMediaUpload(supabase, {
        storeId,
        ownerType: "product",
        productId: parsed.data.productId,
        mimeType: parsed.data.mimeType,
        bytes: parsed.data.bytes,
      }),
    );
    return { ok: true, mediaId: ticket.mediaId, signedUrl: ticket.signedUrl };
  } catch (error) {
    const state = failure("media.upload", error);
    const field = Object.values(state.fields ?? {})[0];
    return { ok: false, error: field ?? state.error ?? "No pudimos preparar la subida." };
  }
}

export async function finalizeProductImageUpload(
  storeHandle: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!uuid.safeParse(mediaId).success) return { ok: false, error: "Subida no válida." };
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      finalizeMediaUpload(supabase, storeId, mediaId),
    );
  } catch (error) {
    return { ok: false, error: failure("media.finalize", error).error };
  }
  revalidatePath(productsPath(storeHandle), "layout");
  return { ok: true };
}

export async function mediaAction(
  storeHandle: string,
  productId: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const action = String(formData.get("action") ?? "");
  const mediaId = String(formData.get("media_id") ?? "");
  if (!uuid.safeParse(mediaId).success || !uuid.safeParse(productId).success) {
    return { error: "Imagen no válida." };
  }
  try {
    await withStore(storeHandle, async ({ supabase, storeId }) => {
      if (action === "alt") {
        await callRpc(supabase, "media_set_alt_text", {
          p_store_id: storeId,
          p_media_id: mediaId,
          p_alt_text: String(formData.get("alt_text") ?? "").slice(0, 300),
        });
      } else if (action === "delete") {
        await callRpc(supabase, "media_delete", { p_store_id: storeId, p_media_id: mediaId });
      } else if (action === "first") {
        await callRpc(supabase, "media_reorder_product", {
          p_store_id: storeId,
          p_product_id: productId,
          p_media_ids: [mediaId],
        });
      } else {
        throw new AppError("validation_failed");
      }
    });
  } catch (error) {
    return failure("media.action", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/${productId}`);
  const messages: Record<string, string> = {
    alt: "Texto alternativo guardado.",
    delete: "Imagen eliminada.",
    first: "Imagen principal actualizada.",
  };
  return { ok: true, message: messages[action] ?? "Listo." };
}

// -----------------------------------------------------------------------------
// Categorías y marcas
// -----------------------------------------------------------------------------
export async function saveCategory(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const id = String(formData.get("id") ?? "");
  const parentId = String(formData.get("parent_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120)
    return { error: "Revisa los datos marcados.", fields: { name: FIELD_MESSAGES.name! } };
  if ((id && !uuid.safeParse(id).success) || (parentId && !uuid.safeParse(parentId).success)) {
    return { error: "Categoría no válida." };
  }
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "catalog_upsert_category", {
        p_store_id: storeId,
        p_category: {
          ...(id ? { id } : {}),
          name,
          parent_id: parentId || null,
          is_visible: formData.get("is_visible") !== "0",
          slug: String(formData.get("slug") ?? "").trim() || undefined,
        },
      }),
    );
  } catch (error) {
    return failure("catalog.category", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/categorias`);
  return {
    ok: true,
    message: id ? `Categoría «${name}» actualizada.` : `Categoría «${name}» creada.`,
  };
}

export async function deleteCategory(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Categoría no válida." };
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "catalog_delete_category", { p_store_id: storeId, p_category_id: id }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "conflict") {
      return { error: "Primero mueve o elimina sus subcategorías." };
    }
    return failure("catalog.category", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/categorias`);
  return { ok: true, message: "Categoría eliminada." };
}

export async function saveBrand(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120)
    return { error: "Revisa los datos marcados.", fields: { name: FIELD_MESSAGES.name! } };
  if (id && !uuid.safeParse(id).success) return { error: "Marca no válida." };
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "catalog_upsert_brand", {
        p_store_id: storeId,
        p_brand: { ...(id ? { id } : {}), name },
      }),
    );
  } catch (error) {
    return failure("catalog.brand", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/marcas`);
  return { ok: true, message: id ? `Marca «${name}» actualizada.` : `Marca «${name}» creada.` };
}

export async function deleteBrand(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const id = String(formData.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Marca no válida." };
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "catalog_delete_brand", { p_store_id: storeId, p_brand_id: id }),
    );
  } catch (error) {
    return failure("catalog.brand", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/marcas`);
  return { ok: true, message: "Marca eliminada. Sus productos quedan sin marca." };
}
