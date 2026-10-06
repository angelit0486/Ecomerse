import "server-only";

import { cache } from "react";

import { gatewayDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";

/**
 * Lecturas del catálogo publicado (funciones storefront.*, rol
 * storefront_gateway, F5-T02). El storeId llega siempre de la ruta verificada
 * (firma del proxy): nunca de un parámetro del comprador.
 */
export type Availability = "in_stock" | "low_stock" | "backorder" | "out_of_stock";

export interface ImageRef {
  path: string;
  width: number | null;
  height: number | null;
  alt: string | null;
}

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  min_price: number | null;
  max_price: number | null;
  compare_at_price: number | null;
  availability: Availability;
  image: ImageRef | null;
}

export interface ProductPage {
  items: ProductCard[];
  sort: ListSort;
  next_cursor: { k: string | number; id: string } | null;
}

export const LIST_SORTS = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
  "best_selling",
] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export interface ListFilters {
  categoryPath?: string | undefined;
  brandSlug?: string | undefined;
  query?: string | undefined;
  sort?: ListSort | undefined;
  available?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  description_html: string | null;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  min_price: number | null;
  max_price: number | null;
  updated_at: string;
  availability: Availability;
  brand: { name: string; slug: string } | null;
  options: { name: string; values: string[] }[];
  variants: {
    id: string;
    signature: string;
    sku: string | null;
    barcode: string | null;
    price: number;
    compare_at_price: number | null;
    availability: Availability;
    image: ImageRef | null;
  }[];
  images: ImageRef[];
  breadcrumb: { name: string; path: string }[];
}

export interface CategoryDetail {
  id: string;
  name: string;
  path: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
  image: ImageRef | null;
  children: { name: string; path: string }[];
  breadcrumb: { name: string; path: string }[];
}

export interface BrandDetail {
  id: string;
  name: string;
  slug: string;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
  logo: ImageRef | null;
}

export interface MenuEntry {
  label: string;
  href: string;
  children: { label: string; href: string }[];
}

export interface PageDetail {
  id: string;
  slug: string;
  type: string;
  title: string;
  body_html: string;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function assertStore(storeId: string) {
  if (!UUID_RE.test(storeId)) throw new Error("storeId inválido");
}

/** Cursor opaco para la URL del listado; manipulado = primera página. */
export function encodeListCursor(cursor: ProductPage["next_cursor"]): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null;
}

function decodeListCursor(value: string | undefined): { k: string; id: string } | null {
  if (!value || value.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString()) as {
      k?: unknown;
      id?: unknown;
    };
    const k = typeof parsed.k === "number" ? String(parsed.k) : parsed.k;
    if (
      typeof k === "string" &&
      /^-?\d+(\.\d+)?$/.test(k) &&
      typeof parsed.id === "string" &&
      UUID_RE.test(parsed.id)
    ) {
      return { k, id: parsed.id };
    }
  } catch {
    // ignorado
  }
  return null;
}

async function call<T>(query: Promise<{ value: unknown }[]>): Promise<T | null> {
  const rows = await query;
  return (rows[0]?.value as T | null | undefined) ?? null;
}

export async function listProducts(storeId: string, filters: ListFilters): Promise<ProductPage> {
  assertStore(storeId);
  const cursor = decodeListCursor(filters.cursor);
  const db = gatewayDb();
  const page = await call<ProductPage>(db`
    select storefront.list_products(
      ${storeId}::uuid, ${filters.categoryPath ?? null}, ${filters.brandSlug ?? null},
      ${filters.query?.slice(0, 200) ?? null}, ${filters.sort ?? null}, null, null,
      ${filters.available ?? false}, ${cursor ? db.json(cursor) : null}::jsonb, ${filters.limit ?? 24}
    ) as value`);
  return page ?? { items: [], sort: "newest", next_cursor: null };
}

export const getProduct = cache(
  async (storeId: string, slug: string): Promise<ProductDetail | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return call<ProductDetail>(
      gatewayDb()`select storefront.get_product(${storeId}::uuid, ${slug}) as value`,
    );
  },
);

export const getCategory = cache(
  async (storeId: string, path: string): Promise<CategoryDetail | null> => {
    assertStore(storeId);
    if (path.length > 500 || !path.split("/").every((part) => SLUG_RE.test(part))) return null;
    return call<CategoryDetail>(
      gatewayDb()`select storefront.get_category(${storeId}::uuid, ${path}) as value`,
    );
  },
);

export const getBrand = cache(
  async (storeId: string, slug: string): Promise<BrandDetail | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return call<BrandDetail>(
      gatewayDb()`select storefront.get_brand(${storeId}::uuid, ${slug}) as value`,
    );
  },
);

export const getPage = cache(async (storeId: string, slug: string): Promise<PageDetail | null> => {
  assertStore(storeId);
  if (!SLUG_RE.test(slug) || slug.length > 120) return null;
  return call<PageDetail>(
    gatewayDb()`select storefront.get_page(${storeId}::uuid, ${slug}) as value`,
  );
});

export const getMenus = cache(
  async (storeId: string): Promise<{ main: MenuEntry[]; footer: MenuEntry[] }> => {
    assertStore(storeId);
    return (
      (await call<{ main: MenuEntry[]; footer: MenuEntry[] }>(
        gatewayDb()`select storefront.get_menus(${storeId}::uuid) as value`,
      )) ?? { main: [], footer: [] }
    );
  },
);

export const getHome = cache(
  async (
    storeId: string,
  ): Promise<{
    featured: ProductCard[];
    categories: { name: string; path: string; image: ImageRef | null }[];
  }> => {
    assertStore(storeId);
    return (
      (await call<{
        featured: ProductCard[];
        categories: { name: string; path: string; image: ImageRef | null }[];
      }>(gatewayDb()`select storefront.get_home(${storeId}::uuid) as value`)) ?? {
        featured: [],
        categories: [],
      }
    );
  },
);

export async function sitemapEntries(
  storeId: string,
): Promise<{ kind: string; path: string; lastmod: Date }[]> {
  assertStore(storeId);
  return gatewayDb()<{ kind: string; path: string; lastmod: Date }[]>`
    select kind, path, lastmod from storefront.sitemap_entries(${storeId}::uuid)`;
}

/** URL pública de un medio ya re-codificado (bucket store-media). */
export function mediaUrl(path: string): string {
  return `${serverEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-media/${path}`;
}
