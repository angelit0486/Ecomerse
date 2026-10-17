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
import { parseMoneyToCents } from "@/lib/money/format";
import { invalidateStore } from "@/server/storefront/cache";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  SUPPLEMENT_CATEGORIES,
  missingSupplementCategories,
} from "@/lib/catalog/supplement-taxonomy";

import { FIELD_MESSAGES, publishIssueMessage } from "./messages";

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
  /** Vista previa de precios en bloque (aún sin aplicar). */
  preview?: BulkPricePreview;
}

export interface BulkPricePreview {
  /** Productos de la vista previa: «Aplicar» solo vale para esta misma selección. */
  ids: string[];
  percent: string;
  rounding: "centavo" | "peso";
  rows: {
    id: string;
    product_id: string;
    title: string;
    options: string;
    sku: string | null;
    price: number;
    new_price: number;
    compare_at_price: number | null;
    new_compare_at_price: number | null;
  }[];
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const uuid = z.uuid();

async function withStore<T>(
  storeHandle: string,
  work: (input: { supabase: Supabase; storeId: string }) => Promise<T>,
): Promise<T> {
  const ctx = await getStoreContext(storeHandle);
  const supabase = await createSupabaseServerClient();
  const result = await work({ supabase, storeId: ctx.store.id });
  // La tienda pública deja de servir lo cacheado de esta tienda (§21.4).
  invalidateStore(ctx.store.id);
  return result;
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
    // Opciones: el mensaje es el de opciones aunque el campo se llame "name".
    const leaf = root === "options" ? "options" : String(issue.path.at(-1) ?? root);
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
  draft: "Producto pausado: ya no se ve en la tienda. Puedes publicarlo de nuevo cuando quieras.",
  archive: "Producto archivado.",
  delete: "Producto eliminado. Puedes restaurarlo desde «Eliminados».",
  restore: "Producto restaurado como borrador.",
  duplicate:
    "Copia creada como borrador, con sus presentaciones, ficha y atributos. Las fotos se copian en segundo plano y aparecen al terminar.",
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
          throw new PublishBlocked(errors.map((i) => publishIssueMessage(i.code)));
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

const BULK_ACTIONS = ["publish", "draft", "archive", "delete"] as const;
const BULK_EDITS = ["brand", "category_add", "category_remove", "prices"] as const;
type BulkEdit = (typeof BULK_EDITS)[number];

interface BulkResult {
  changed?: number;
  applied?: boolean;
  rows?: BulkPricePreview["rows"];
}

const BULK_PUBLISH_BLOCKED =
  "No se aplicó: algún producto publicado dejaría de cumplir lo necesario para estar a la venta (por ejemplo, precio 0 o una categoría que exige la ficha sanitaria). Despublícalo o corrígelo primero.";

/**
 * Ediciones en bloque (tanda 4): marca, categoría y precios por porcentaje.
 * Todo o nada: la base valida la selección completa y audita cada producto.
 */
async function bulkEdit(
  storeHandle: string,
  action: BulkEdit,
  ids: string[],
  formData: FormData,
): Promise<CatalogActionState> {
  const brandId = String(formData.get("brand_id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "");
  const percentText = String(formData.get("percent") ?? "")
    .trim()
    .replace(",", ".");
  const rounding = formData.get("rounding") === "peso" ? "peso" : "centavo";
  const apply = formData.get("confirm") === "1";
  if (action === "brand" && brandId && !uuid.safeParse(brandId).success) {
    return { error: "Elige una marca." };
  }
  if (action.startsWith("category") && !uuid.safeParse(categoryId).success) {
    return { error: "Elige una categoría." };
  }
  const percent = Number(percentText);
  if (
    action === "prices" &&
    (!/^-?\d{1,3}(\.\d{1,2})?$/.test(percentText) ||
      percent === 0 ||
      percent < -90 ||
      percent > 500)
  ) {
    return {
      error: "Escribe un porcentaje entre -90 y 500 (por ejemplo 10 para subir o -15 para bajar).",
      fields: { percent: "Porcentaje no válido." },
    };
  }
  try {
    const result = await withStore(storeHandle, ({ supabase, storeId }) => {
      switch (action) {
        case "brand":
          return callRpc<BulkResult>(supabase, "catalog_bulk_set_brand", {
            p_store_id: storeId,
            p_product_ids: ids,
            p_brand_id: brandId || null,
          });
        case "category_add":
        case "category_remove":
          return callRpc<BulkResult>(supabase, "catalog_bulk_category", {
            p_store_id: storeId,
            p_product_ids: ids,
            p_category_id: categoryId,
            p_mode: action === "category_add" ? "add" : "remove",
          });
        case "prices":
          return callRpc<BulkResult>(supabase, "catalog_bulk_adjust_prices", {
            p_store_id: storeId,
            p_product_ids: ids,
            p_percent: percent,
            p_rounding: rounding,
            p_apply: apply,
          });
      }
    });
    if (action === "prices" && !apply) {
      return { preview: { ids, percent: percentText, rounding, rows: result.rows ?? [] } };
    }
    revalidatePath(productsPath(storeHandle));
    if (action === "prices") {
      // Solo cuentan los productos con algún precio realmente distinto.
      const products = new Set(
        (result.rows ?? [])
          .filter((r) => r.price !== r.new_price || r.compare_at_price !== r.new_compare_at_price)
          .map((r) => r.product_id),
      );
      if (products.size === 0)
        return { ok: true, message: "Sin cambios: los precios ya eran esos." };
      return {
        ok: true,
        message: `Precios actualizados en ${products.size} producto${products.size === 1 ? "" : "s"}.`,
      };
    }
    const changed = result.changed ?? 0;
    if (changed === 0) return { ok: true, message: "Sin cambios: ya estaban así." };
    const n = changed === 1 ? "" : "s";
    const what = {
      brand: brandId ? `con la marca nueva` : `sin marca`,
      category_add: `agregado${n} a la categoría`,
      category_remove: `quitado${n} de la categoría`,
    }[action];
    return { ok: true, message: `${changed} producto${n} ${what}.` };
  } catch (error) {
    const state = failure(`catalog.bulk_${action}`, error);
    return state.fields?.publish ? { error: BULK_PUBLISH_BLOCKED } : state;
  }
}

/** Acciones masivas del listado: cada producto pasa por la misma RPC y permisos. */
export async function bulkProductsAction(
  storeHandle: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const action = String(formData.get("action") ?? "");
  const ids = formData.getAll("ids").map(String);
  const isEdit = (BULK_EDITS as readonly string[]).includes(action);
  if (!isEdit && !(BULK_ACTIONS as readonly string[]).includes(action)) {
    return { error: "Elige una acción." };
  }
  if (ids.length === 0) return { error: "Selecciona al menos un producto." };
  if (ids.length > 100 || !ids.every((id) => uuid.safeParse(id).success)) {
    return { error: "Selección no válida." };
  }
  if (isEdit) return bulkEdit(storeHandle, action as BulkEdit, ids, formData);
  let done = 0;
  // Publicar valida cada producto (precio, fotos, ficha sanitaria): los que no
  // pasan no detienen a los demás; se informa cuántos y por qué.
  const skipped: string[] = [];
  try {
    await withStore(storeHandle, async ({ supabase, storeId }) => {
      for (const id of ids) {
        if (action === "publish") {
          try {
            await applyStatus(supabase, storeId, id, "publish");
            done += 1;
          } catch (error) {
            const e = failure("catalog.bulk_publish", error);
            skipped.push(e.error ?? "No se pudo publicar.");
          }
          continue;
        }
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
  if (action === "publish" && skipped.length > 0) {
    const reasons = [...new Set(skipped)];
    return {
      ...(done > 0 ? { ok: true } : {}),
      error: `${done} publicado${done === 1 ? "" : "s"}; ${skipped.length} no se pudo publicar. Ábrelo para ver qué le falta.`,
      issues: reasons.slice(0, 5),
    };
  }
  const verb = {
    publish: one ? "producto publicado" : "productos publicados",
    draft: one
      ? "producto pausado (ya no se ve en la tienda)"
      : "productos pausados (ya no se ven en la tienda)",
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
      } else if (action === "left" || action === "right") {
        // Orden actual leído de la base (no del navegador) y se intercambia con la vecina.
        const { data, error } = await supabase
          .from("media")
          .select("id")
          .eq("store_id", storeId)
          .eq("product_id", productId)
          .is("deleted_at", null)
          .order("position")
          .order("id");
        if (error) throw error;
        const order = (data ?? []).map((m: { id: string }) => m.id);
        const from = order.indexOf(mediaId);
        const to = action === "left" ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= order.length) throw new AppError("validation_failed");
        [order[from], order[to]] = [order[to]!, order[from]!];
        await callRpc(supabase, "media_reorder_product", {
          p_store_id: storeId,
          p_product_id: productId,
          p_media_ids: order,
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
    left: "Foto movida.",
    right: "Foto movida.",
  };
  return { ok: true, message: messages[action] ?? "Listo." };
}

/**
 * Cambio rápido de precios desde el listado: precio y «precio antes» de cada
 * presentación de un producto. La base valida, recalcula y audita.
 */
export async function quickPricesAction(
  storeHandle: string,
  productId: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const ids = formData.getAll("variant_id").map(String);
  if (
    !uuid.safeParse(productId).success ||
    ids.length === 0 ||
    ids.length > 100 ||
    ids.some((id) => !uuid.safeParse(id).success)
  ) {
    return { error: "Selección no válida." };
  }
  const fields: Record<string, string> = {};
  const prices = ids.map((id) => {
    const normalize = (v: FormDataEntryValue | null) => {
      const t = String(v ?? "").trim();
      // Excel y teclados en español escriben "199,50".
      return /^\d+,\d{1,2}$/.test(t) ? t.replace(",", ".") : t;
    };
    const priceText = normalize(formData.get(`price_${id}`));
    const compareText = normalize(formData.get(`compare_${id}`));
    const price = parseMoneyToCents(priceText);
    const compare = compareText ? parseMoneyToCents(compareText) : null;
    // La base acepta hasta 15 dígitos de centavos.
    if (price === null || price > 999_999_999_999_999) {
      fields[`price_${id}`] = "Escribe un precio como 199.50.";
    } else if (compareText && compare === null)
      fields[`compare_${id}`] = "Escribe un importe como 249.00.";
    else if (compare !== null && compare <= price) {
      fields[`compare_${id}`] = "Debe ser mayor que el precio.";
    }
    return { id, price: price ?? 0, compare_at_price: compare };
  });
  if (Object.keys(fields).length > 0) return { error: "Revisa los precios marcados.", fields };
  let changed = 0;
  try {
    const result = await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc<{ changed: number }>(supabase, "catalog_set_variant_prices", {
        p_store_id: storeId,
        p_product_id: productId,
        p_prices: prices,
      }),
    );
    changed = result.changed;
  } catch (error) {
    return failure("catalog.quick_prices", error);
  }
  revalidatePath(productsPath(storeHandle));
  return {
    ok: true,
    message:
      changed === 0 ? "Sin cambios." : changed === 1 ? "Precio guardado." : "Precios guardados.",
  };
}

/** Foto propia de una presentación (sabor, tamaño); vacío = usa la del producto. */
export async function setVariantImageAction(
  storeHandle: string,
  productId: string,
  _: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const variantId = String(formData.get("variant_id") ?? "");
  const mediaId = String(formData.get("media_id") ?? "");
  if (
    !uuid.safeParse(productId).success ||
    !uuid.safeParse(variantId).success ||
    (mediaId && !uuid.safeParse(mediaId).success)
  ) {
    return { error: "Selección no válida." };
  }
  try {
    await withStore(storeHandle, ({ supabase, storeId }) =>
      callRpc(supabase, "catalog_set_variant_image", {
        p_store_id: storeId,
        p_variant_id: variantId,
        p_media_id: mediaId || null,
      }),
    );
  } catch (error) {
    return failure("catalog.variant_image", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/${productId}`);
  return {
    ok: true,
    message: mediaId ? "Foto de la presentación guardada." : "Usará la foto del producto.",
  };
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
          is_visible: formData.getAll("is_visible").includes("1"),
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

/**
 * Crea las categorías sugeridas de suplementos que falten (primer nivel,
 * visibles, en el orden sugerido). Idempotente: lo que ya existe por dirección o
 * nombre no se toca. Cada alta pasa por catalog_upsert_category (permisos y
 * validaciones en la base).
 */
export async function createSupplementCategories(
  storeHandle: string,
  _: CatalogActionState,
): Promise<CatalogActionState> {
  let created = 0;
  try {
    await withStore(storeHandle, async ({ supabase, storeId }) => {
      const { data, error } = await supabase
        .from("categories")
        .select("name, slug, depth")
        .eq("store_id", storeId)
        .is("deleted_at", null);
      if (error) throw error;
      for (const category of missingSupplementCategories(data ?? [])) {
        await callRpc(supabase, "catalog_upsert_category", {
          p_store_id: storeId,
          p_category: {
            name: category.name,
            slug: category.slug,
            parent_id: null,
            is_visible: true,
            position: SUPPLEMENT_CATEGORIES.indexOf(category) + 1,
          },
        });
        created += 1;
      }
    });
  } catch (error) {
    return failure("catalog.category", error);
  }
  revalidatePath(`${productsPath(storeHandle)}/categorias`);
  return {
    ok: true,
    message:
      created === 0
        ? "Ya tienes todas las categorías sugeridas."
        : created === 1
          ? "Se creó 1 categoría."
          : `Se crearon ${created} categorías.`,
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
