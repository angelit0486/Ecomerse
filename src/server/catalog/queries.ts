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
}

export interface ProductListFilters {
  query?: string | undefined;
  status?: "draft" | "active" | "archived" | undefined;
  categoryId?: string | undefined;
  deleted?: boolean | undefined;
  cursor?: { updated_at: string; id: string } | undefined;
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
    p_cursor: filters.cursor ?? null,
    p_limit: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor({ updated_at: last.updated_at, id: last.id })
        : null,
  };
}

/** Cursor opaco para la URL (base64url de JSON); se valida al leerlo. */
export function encodeCursor(cursor: { updated_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(
  value: string | undefined,
): { updated_at: string; id: string } | undefined {
  if (!value || value.length > 200) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.updated_at === "string" &&
      !Number.isNaN(Date.parse(parsed.updated_at)) &&
      typeof parsed.id === "string" &&
      /^[0-9a-f-]{36}$/.test(parsed.id)
    ) {
      return { updated_at: parsed.updated_at, id: parsed.id };
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
}

export async function listCategories(
  supabase: SupabaseClient,
  storeId: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, parent_id, name, slug, path, depth, position, is_visible")
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

export interface MediaRow {
  id: string;
  status: "pending" | "ready" | "rejected";
  alt_text: string | null;
  position: number;
  width: number | null;
  height: number | null;
  rejection_reason: string | null;
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
      "id, title, slug, status, description_html, brand_id, tags, seo_title, seo_description, deleted_at",
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
      .select("id, sku, barcode, price, compare_at_price, status, position, option_signature")
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
      .select("id, status, alt_text, position, width, height, rejection_reason, storage_path")
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
