import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { callRpc } from "@/server/db/rpc";
import { serverEnv } from "@/server/env";

/**
 * Lecturas del catálogo para el panel, con el cliente del usuario (RLS:
 * products.read; costos con products.cost.read). Nada se cachea entre
 * requests (§44.7).
 */
export interface ProductListRow {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  min_price: number | null;
  max_price: number | null;
  variant_count: number;
  updated_at: string;
  deleted_at: string | null;
  /** Clave del cursor según el orden (la calcula la base). */
  sort_key: string;
}

export const PRODUCT_SORTS = ["recientes", "nombre", "precio_asc", "precio_desc"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** Cursor de una página: solo vale para el orden con que se generó. */
export interface ProductCursor {
  s: ProductSort;
  k: string;
  id: string;
}

export interface ProductListFilters {
  query?: string | undefined;
  status?: "draft" | "active" | "archived" | undefined;
  categoryId?: string | undefined;
  brandId?: string | undefined;
  /** Pendientes: alguna presentación agotada, ninguna foto lista o pocas existencias. */
  issue?: "agotados" | "sin_foto" | "pocas_existencias" | undefined;
  deleted?: boolean | undefined;
  sort?: ProductSort | undefined;
  cursor?: ProductCursor | undefined;
}

export const PAGE_SIZE = 25;

export async function searchProducts(
  supabase: SupabaseClient,
  storeId: string,
  filters: ProductListFilters,
): Promise<{ rows: ProductListRow[]; nextCursor: string | null }> {
  const rows = await callRpc<ProductListRow[]>(supabase, "catalog_search_products", {
    p_store_id: storeId,
    p_query: filters.query ?? null,
    p_status: filters.status ?? null,
    p_category_id: filters.categoryId ?? null,
    p_deleted: filters.deleted ?? false,
    p_cursor: filters.cursor ? { k: filters.cursor.k, id: filters.cursor.id } : null,
    p_limit: PAGE_SIZE + 1,
    p_brand_id: filters.brandId ?? null,
    p_issue: filters.issue ?? null,
    p_sort: filters.sort ?? "recientes",
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor({ s: filters.sort ?? "recientes", k: last.sort_key, id: last.id })
        : null,
  };
}

/** Cursor opaco para la URL (base64url de JSON); se valida al leerlo. */
export function encodeCursor(cursor: ProductCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** Fecha como la escribe Postgres (`2026-10-17 20:00:00.123456+00`) o en ISO. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

/**
 * Un cursor de otro orden (o manipulado) se ignora: se vuelve a la primera
 * página en lugar de mezclar resultados. La base vuelve a validar la clave.
 */
export function decodeCursor(
  value: string | undefined,
  sort: ProductSort = "recientes",
): ProductCursor | undefined {
  // Un título de 200 caracteres con acentos ocupa ~650 en base64.
  if (!value || value.length > 1200) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as Record<
      string,
      unknown
    >;
    if (
      parsed.s === sort &&
      typeof parsed.k === "string" &&
      parsed.k.length <= 300 &&
      (sort === "nombre" ||
        (sort === "recientes" ? TIMESTAMP.test(parsed.k) : /^\d{1,15}$/.test(parsed.k))) &&
      typeof parsed.id === "string" &&
      /^[0-9a-f-]{36}$/.test(parsed.id)
    ) {
      return { s: sort, k: parsed.k, id: parsed.id };
    }
  } catch {
    // cursor manipulado: se ignora
  }
  return undefined;
}

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  path: string;
  depth: number;
  position: number;
  is_visible: boolean;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

export async function listCategories(
  supabase: SupabaseClient,
  storeId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select(
      "id, parent_id, name, slug, path, depth, position, is_visible, description, seo_title, seo_description",
    )
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("path");
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
}

export async function listBrands(supabase: SupabaseClient, storeId: string): Promise<BrandRow[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  return (data ?? []) as BrandRow[];
}

export interface BrandImage {
  id: string;
  status: "pending" | "ready" | "rejected";
  /** Solo cuando ya está procesada. */
  url: string | null;
}

export interface BrandProfile extends BrandRow {
  description: string | null;
  website_url: string | null;
  logo: BrandImage | null;
  cover: BrandImage | null;
}

/** Marcas con su logo y su portada, para la pantalla Marcas (misión Portada/Marcas, Paso 2). */
export async function listBrandProfiles(
  supabase: SupabaseClient,
  storeId: string,
): Promise<BrandProfile[]> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug, description, website_url, logo_media_id, cover_media_id")
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw error;
  const rows = (data ?? []) as (BrandRow & {
    description: string | null;
    website_url: string | null;
    logo_media_id: string | null;
    cover_media_id: string | null;
  })[];
  const media = await mediaViews(
    supabase,
    storeId,
    rows.flatMap((r) => [r.logo_media_id, r.cover_media_id]),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    website_url: r.website_url,
    logo: r.logo_media_id ? (media.get(r.logo_media_id) ?? null) : null,
    cover: r.cover_media_id ? (media.get(r.cover_media_id) ?? null) : null,
  }));
}

/** Estado y URL pública de varias imágenes de la tienda (no borradas). */
async function mediaViews(
  supabase: SupabaseClient,
  storeId: string,
  ids: (string | null)[],
): Promise<Map<string, BrandImage>> {
  const wanted = [...new Set(ids.filter(Boolean) as string[])];
  const media = new Map<string, BrandImage>();
  if (wanted.length === 0) return media;
  const { data, error } = await supabase
    .from("media")
    .select("id, status, storage_path")
    .eq("store_id", storeId)
    .in("id", wanted)
    .is("deleted_at", null);
  if (error) throw error;
  for (const m of data ?? []) {
    media.set(m.id as string, {
      id: m.id as string,
      status: m.status as BrandImage["status"],
      url: m.status === "ready" ? publicMediaUrl(m.storage_path as string) : null,
    });
  }
  return media;
}

/** Foto cuadrada y banner de cada categoría (misión Panel, Paso A). */
export async function listCategoryImages(
  supabase: SupabaseClient,
  storeId: string,
): Promise<Map<string, { image: BrandImage | null; cover: BrandImage | null }>> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, image_media_id, cover_media_id")
    .eq("store_id", storeId)
    .is("deleted_at", null);
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    image_media_id: string | null;
    cover_media_id: string | null;
  }[];
  const media = await mediaViews(
    supabase,
    storeId,
    rows.flatMap((r) => [r.image_media_id, r.cover_media_id]),
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        image: r.image_media_id ? (media.get(r.image_media_id) ?? null) : null,
        cover: r.cover_media_id ? (media.get(r.cover_media_id) ?? null) : null,
      },
    ]),
  );
}

export interface MediaRow {
  id: string;
  status: "pending" | "ready" | "rejected";
  alt_text: string | null;
  position: number;
  width: number | null;
  height: number | null;
  rejection_reason: string | null;
  created_at: string;
  url: string | null;
}

export function publicMediaUrl(path: string): string {
  return `${serverEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-media/${path}`;
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "active" | "archived";
  description_html: string | null;
  brand_id: string | null;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  deleted_at: string | null;
  /** Publicación programada (tanda 7); null sin programar. */
  publish_at: string | null;
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    options: Record<string, string>;
    sku: string | null;
    barcode: string | null;
    price: number;
    compare_at_price: number | null;
    cost: number | null;
    status: "active" | "inactive";
    position: number;
    /** ADR-026: contenido y porciones de esta presentación (null = las del producto). */
    net_content: string | null;
    servings_per_container: number | null;
    /** Foto propia de la presentación (null = la del producto). */
    image_id: string | null;
    track_inventory: boolean;
  }[];
  categories: { id: string; is_primary: boolean }[];
  media: MediaRow[];
}

/** Firma "Color=Negro|Talla=M" → { Color: "Negro", Talla: "M" } (sin "=" ni "|" en nombres). */
export function parseSignature(signature: string): Record<string, string> {
  if (!signature) return {};
  return Object.fromEntries(
    signature.split("|").map((pair) => {
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

export async function getProduct(
  supabase: SupabaseClient,
  storeId: string,
  productId: string,
  canReadCost: boolean,
): Promise<ProductDetail | null> {
  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, title, slug, status, description_html, brand_id, tags, seo_title, seo_description, deleted_at, publish_at",
    )
    .eq("store_id", storeId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!product) return null;

  const [options, variants, categories, media] = await Promise.all([
    supabase
      .from("product_options")
      .select("id, name, position, product_option_values(value, position)")
      .eq("product_id", productId)
      .order("position"),
    supabase
      .from("product_variants")
      .select(
        "id, sku, barcode, price, compare_at_price, status, position, option_signature, net_content, servings_per_container, image_id, track_inventory",
      )
      .eq("product_id", productId)
      .is("deleted_at", null)
      .order("position")
      .order("option_signature"),
    supabase
      .from("product_categories")
      .select("category_id, is_primary")
      .eq("product_id", productId),
    supabase
      .from("media")
      .select(
        "id, status, alt_text, position, width, height, rejection_reason, storage_path, created_at",
      )
      .eq("product_id", productId)
      .is("deleted_at", null)
      .order("position"),
  ]);
  for (const result of [options, variants, categories, media]) if (result.error) throw result.error;

  const variantRows = (variants.data ?? []) as Array<{
    id: string;
    sku: string | null;
    barcode: string | null;
    price: number;
    compare_at_price: number | null;
    status: "active" | "inactive";
    position: number;
    option_signature: string;
    net_content: string | null;
    servings_per_container: number | null;
    image_id: string | null;
    track_inventory: boolean;
  }>;
  const costs = new Map<string, number>();
  if (canReadCost && variantRows.length > 0) {
    const { data, error: costError } = await supabase
      .from("variant_costs")
      .select("variant_id, cost")
      .in(
        "variant_id",
        variantRows.map((v) => v.id),
      );
    if (costError) throw costError;
    for (const row of (data ?? []) as { variant_id: string; cost: number }[])
      costs.set(row.variant_id, row.cost);
  }

  return {
    ...(product as Omit<ProductDetail, "options" | "variants" | "categories" | "media">),
    options: (
      (options.data ?? []) as Array<{
        name: string;
        product_option_values: { value: string; position: number }[];
      }>
    ).map((o) => ({
      name: o.name,
      values: [...o.product_option_values]
        .sort((a, b) => a.position - b.position)
        .map((v) => v.value),
    })),
    variants: variantRows.map((v) => ({
      id: v.id,
      options: parseSignature(v.option_signature),
      sku: v.sku,
      barcode: v.barcode,
      price: Number(v.price),
      compare_at_price: v.compare_at_price == null ? null : Number(v.compare_at_price),
      cost: costs.has(v.id) ? Number(costs.get(v.id)) : null,
      status: v.status,
      position: v.position,
      net_content: v.net_content,
      servings_per_container: v.servings_per_container,
      image_id: v.image_id,
      track_inventory: v.track_inventory,
    })),
    categories: ((categories.data ?? []) as { category_id: string; is_primary: boolean }[]).map(
      (c) => ({
        id: c.category_id,
        is_primary: c.is_primary,
      }),
    ),
    media: ((media.data ?? []) as Array<Omit<MediaRow, "url"> & { storage_path: string }>).map(
      ({ storage_path, ...m }) => ({
        ...m,
        url: m.status === "ready" ? publicMediaUrl(storage_path) : null,
      }),
    ),
  };
}

export async function validateProduct(
  supabase: SupabaseClient,
  storeId: string,
  productId: string,
): Promise<{ code: string; level: "error" | "warning" }[]> {
  return callRpc(supabase, "catalog_validate_product", {
    p_store_id: storeId,
    p_product_id: productId,
  });
}

/** Revisión del catálogo (super prompt §16): avisos y bloqueos por producto. */
export interface CatalogQuality {
  checked: number;
  total: number;
  by_code: Record<string, number>;
  products: Array<{ id: string; title: string; status: string; codes: string[] }>;
}

export function getCatalogQuality(
  supabase: SupabaseClient,
  storeId: string,
): Promise<CatalogQuality> {
  return callRpc<CatalogQuality>(supabase, "catalog_quality_report", { p_store_id: storeId });
}

/** Producto al que puede ir una foto de la subida en lote (por nombre corto o SKU). */
export interface ImageTarget {
  id: string;
  title: string;
  slug: string;
  skus: string[];
  variants: { id: string; sku: string }[];
  image_count: number;
}

const READ_PAGE = 1000;

/** Lee todas las filas en páginas: la Data API devuelve como mucho `max_rows` (1000). */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await page(from, from + READ_PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < READ_PAGE) return rows;
  }
}

/** Productos vigentes de la tienda con sus SKU (RLS: solo lo que el usuario puede ver). */
export async function listImageTargets(
  supabase: SupabaseClient,
  storeId: string,
): Promise<ImageTarget[]> {
  const [products, variants, media] = await Promise.all([
    readAll<{ id: string; title: string; slug: string }>((from, to) =>
      supabase
        .from("products")
        .select("id, title, slug")
        .eq("store_id", storeId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ),
    readAll<{ id: string; product_id: string; sku: string | null }>((from, to) =>
      supabase
        .from("product_variants")
        .select("id, product_id, sku")
        .eq("store_id", storeId)
        .is("deleted_at", null)
        .not("sku", "is", null)
        .order("id")
        .range(from, to),
    ),
    readAll<{ product_id: string | null }>((from, to) =>
      supabase
        .from("media")
        .select("product_id")
        .eq("store_id", storeId)
        .eq("owner_type", "product")
        .is("deleted_at", null)
        .neq("status", "rejected")
        .order("id")
        .range(from, to),
    ),
  ]);
  const byProduct = new Map<string, { id: string; sku: string }[]>();
  for (const v of variants) {
    if (v.sku)
      byProduct.set(v.product_id, [
        ...(byProduct.get(v.product_id) ?? []),
        { id: v.id, sku: v.sku },
      ]);
  }
  const images = new Map<string, number>();
  for (const m of media) {
    if (m.product_id) images.set(m.product_id, (images.get(m.product_id) ?? 0) + 1);
  }
  return products.map((p) => ({
    ...p,
    skus: (byProduct.get(p.id) ?? []).map((v) => v.sku),
    variants: byProduct.get(p.id) ?? [],
    image_count: images.get(p.id) ?? 0,
  }));
}
