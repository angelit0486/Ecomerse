import "server-only";

import { cache } from "react";

import { hasSelection, type AttributeSelection } from "@/lib/catalog/attributes";
import type { SupplementSheet } from "@/server/catalog/regulatory";
import { gatewayDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";

import { cachedRead, COMPLIANCE_TAG } from "./cache";

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
  /** Insignia «Nuevo» (F9-T03/T04). */
  published_at?: string | null;
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
  /** Filtros de atributos (R-T04): OR dentro de un atributo, AND entre atributos. */
  attributes?: AttributeSelection | undefined;
  /** Filtro de marca por slug (F9-T04): OR entre marcas, AND con lo demás. */
  brands?: string[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** Filtro con conteo por valor (R-T04, ADR-022). */
export interface Facet {
  key: string;
  name: string;
  values: { key: string; label: string; count: number; selected: boolean }[];
}

/** Atributos de un producto publicado, para su ficha. */
export interface ProductAttribute {
  key: string;
  name: string;
  filterable: boolean;
  values: { key: string; label: string }[];
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
  published_at: string | null;
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

/**
 * Solo se cachea la primera página sin búsqueda ni filtros de atributos:
 * cursores, textos libres y combinaciones de filtros son ilimitados y llenarían
 * la caché con claves de un solo uso (Gate F5).
 */
function cacheable(
  filters: Pick<ListFilters, "cursor" | "query" | "attributes" | "brands">,
): boolean {
  return (
    !filters.cursor &&
    !filters.query &&
    !(filters.attributes && hasSelection(filters.attributes)) &&
    !filters.brands?.length
  );
}

function brandsParam(filters: ListFilters): string[] | null {
  return filters.brands?.length ? filters.brands.slice(0, 20) : null;
}

function attributesParam(db: ReturnType<typeof gatewayDb>, filters: ListFilters) {
  return filters.attributes && hasSelection(filters.attributes)
    ? db.json(filters.attributes)
    : null;
}

export async function listProducts(storeId: string, filters: ListFilters): Promise<ProductPage> {
  assertStore(storeId);
  return cacheable(filters)
    ? listProductsCached(storeId, filters)
    : readListProducts(storeId, filters);
}

const readListProducts = async (storeId: string, filters: ListFilters): Promise<ProductPage> => {
  const cursor = decodeListCursor(filters.cursor);
  const db = gatewayDb();
  const page = await call<ProductPage>(db`
    select storefront.list_products(
      ${storeId}::uuid, ${filters.categoryPath ?? null}, ${filters.brandSlug ?? null},
      ${filters.query?.slice(0, 200) ?? null}, ${filters.sort ?? null}, null, null,
      ${filters.available ?? false}, ${cursor ? db.json(cursor) : null}::jsonb, ${filters.limit ?? 24},
      ${attributesParam(db, filters)}::jsonb, ${brandsParam(filters)}::text[]
    ) as value`);
  return page ?? ({ items: [], sort: "newest", next_cursor: null } satisfies ProductPage);
};

const listProductsCached = cachedRead("list_products", readListProducts);

/** Filtros con conteo del mismo listado (mismas reglas de caché que el listado). */
export async function listFacets(storeId: string, filters: ListFilters): Promise<Facet[]> {
  assertStore(storeId);
  return cacheable(filters) ? listFacetsCached(storeId, filters) : readListFacets(storeId, filters);
}

const readListFacets = async (storeId: string, filters: ListFilters): Promise<Facet[]> => {
  const db = gatewayDb();
  return (
    (await call<Facet[]>(db`
      select storefront.list_facets(
        ${storeId}::uuid, ${filters.categoryPath ?? null}, ${filters.brandSlug ?? null},
        ${filters.query?.slice(0, 200) ?? null}, ${filters.available ?? false},
        ${attributesParam(db, filters)}::jsonb, ${brandsParam(filters)}::text[]
      ) as value`)) ?? []
  );
};

const listFacetsCached = cachedRead("list_facets", readListFacets);

export const getProduct = cache(
  async (storeId: string, slug: string): Promise<ProductDetail | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return productCached(storeId, slug);
  },
);

/** «Más para tu objetivo» (F9-T03): comparten objetivo, sabor… y luego categoría. */
export const getRelatedProducts = cache(
  async (storeId: string, slug: string): Promise<ProductCard[]> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return [];
    return (await relatedCached(storeId, slug)) ?? [];
  },
);

const relatedCached = cachedRead("related_products", (storeId: string, slug: string) =>
  call<ProductCard[]>(
    gatewayDb()`select storefront.related_products(${storeId}::uuid, ${slug}, 8) as value`,
  ),
);

/** Umbral real de envío gratis para el país de la tienda (F9-T03); null si no hay. */
export interface ShippingPromo {
  free_over: number;
  /** Solo en algunas regiones o pesos: la tienda dice «según destino». */
  conditional: boolean;
}

export const getShippingPromo = cache(async (storeId: string): Promise<ShippingPromo | null> => {
  assertStore(storeId);
  return shippingPromoCached(storeId);
});

const shippingPromoCached = cachedRead("shipping_promo", (storeId: string) =>
  call<ShippingPromo>(gatewayDb()`select storefront.shipping_promo(${storeId}::uuid) as value`),
);

/** Ficha sanitaria pública de un producto regulado (ADR-021, R-T03). */
export interface ProductRegulatory {
  category: string;
  category_name: string;
  data: SupplementSheet;
  /** Leyendas vigentes para la ficha del producto: solo el texto. */
  legends: { key: string; text: string }[];
}

export const getProductRegulatory = cache(
  async (storeId: string, slug: string): Promise<ProductRegulatory | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return productRegulatoryCached(storeId, slug);
  },
);

export const getProductAttributes = cache(
  async (storeId: string, slug: string): Promise<ProductAttribute[]> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return [];
    return (await productAttributesCached(storeId, slug)) ?? [];
  },
);

export const getCategory = cache(
  async (storeId: string, path: string): Promise<CategoryDetail | null> => {
    assertStore(storeId);
    if (path.length > 500 || !path.split("/").every((part) => SLUG_RE.test(part))) return null;
    return categoryCached(storeId, path);
  },
);

export const getBrand = cache(
  async (storeId: string, slug: string): Promise<BrandDetail | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return brandCached(storeId, slug);
  },
);

export const getPage = cache(async (storeId: string, slug: string): Promise<PageDetail | null> => {
  assertStore(storeId);
  if (!SLUG_RE.test(slug) || slug.length > 120) return null;
  return pageCached(storeId, slug);
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

/** Una sección de la portada ya resuelta por la base (app.home_resolve, F9-T02). */
export type HomeSectionData =
  | {
      id: string;
      type: "hero";
      heading: string;
      subheading?: string | null;
      align: "left" | "center";
      cta?: { label: string; link: string } | null;
      image: ImageRef | null;
    }
  | {
      id: string;
      type: "featured_products";
      title: string;
      show_view_all: boolean;
      source:
        | { type: "newest" | "best_selling" }
        | { type: "category"; path: string }
        | { type: "brand"; slug: string }
        | { type: "attribute_value"; attribute: string; value: string };
      items: ProductCard[];
    }
  | {
      id: string;
      type: "category_grid";
      title: string;
      categories: { name: string; path: string; image: ImageRef | null }[];
    }
  | {
      id: string;
      type: "promo_banner";
      heading?: string;
      text?: string;
      cta?: { label: string; link: string };
      image: ImageRef;
    }
  | {
      id: string;
      type: "image_with_text";
      heading: string;
      body: string;
      cta?: { label: string; link: string };
      image_position: "left" | "right";
      image: ImageRef;
    }
  | {
      id: string;
      type: "brand_logos";
      title: string;
      brands: { name: string; slug: string; logo: Omit<ImageRef, "alt"> }[];
    }
  | {
      id: string;
      type: "testimonials";
      title: string;
      items: { quote: string; author: string; detail?: string }[];
    }
  | { id: string; type: "rich_text"; heading?: string; html: string };

/**
 * Portada: secciones publicadas (o del borrador en la vista previa) o, si la
 * tienda no configuró ninguna, la plantilla del tema (§20.2).
 */
export interface HomeData {
  sections: HomeSectionData[] | null;
  featured?: ProductCard[];
  categories?: { name: string; path: string; image: ImageRef | null }[];
}

export const getHome = cache(async (storeId: string): Promise<HomeData> => {
  assertStore(storeId);
  return homeCached(storeId);
});

const homeCached = cachedRead(
  "get_home",
  async (storeId: string) =>
    (await call<HomeData>(gatewayDb()`select storefront.get_home(${storeId}::uuid) as value`)) ?? {
      sections: null,
      featured: [],
      categories: [],
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

const productCached = cachedRead("get_product", (storeId: string, slug: string) =>
  call<ProductDetail>(
    gatewayDb()`select storefront.get_product(${storeId}::uuid, ${slug}) as value`,
  ),
);
const productRegulatoryCached = cachedRead(
  "get_product_regulatory",
  (storeId: string, slug: string) =>
    call<ProductRegulatory>(
      gatewayDb()`select storefront.get_product_regulatory(${storeId}::uuid, ${slug}) as value`,
    ),
  [COMPLIANCE_TAG],
);
const productAttributesCached = cachedRead(
  "get_product_attributes",
  (storeId: string, slug: string) =>
    call<ProductAttribute[]>(
      gatewayDb()`select storefront.get_product_attributes(${storeId}::uuid, ${slug}) as value`,
    ),
);
const categoryCached = cachedRead("get_category", (storeId: string, path: string) =>
  call<CategoryDetail>(
    gatewayDb()`select storefront.get_category(${storeId}::uuid, ${path}) as value`,
  ),
);
const brandCached = cachedRead("get_brand", (storeId: string, slug: string) =>
  call<BrandDetail>(gatewayDb()`select storefront.get_brand(${storeId}::uuid, ${slug}) as value`),
);
const pageCached = cachedRead("get_page", (storeId: string, slug: string) =>
  call<PageDetail>(gatewayDb()`select storefront.get_page(${storeId}::uuid, ${slug}) as value`),
);

/** Sugerencias del buscador (F9-T04): lo publicado que coincide con lo escrito. */
export interface SearchSuggestions {
  products: {
    slug: string;
    title: string;
    brand: string | null;
    min_price: number | null;
    image: ImageRef | null;
  }[];
  categories: { name: string; path: string }[];
  brands: { name: string; slug: string }[];
  values: { attribute: string; attribute_name: string; key: string; label: string }[];
}

const EMPTY_SUGGESTIONS: SearchSuggestions = {
  products: [],
  categories: [],
  brands: [],
  values: [],
};

/**
 * Sin caché de datos: cada texto es una clave nueva y llenaría la caché con
 * entradas de un solo uso (mismo criterio que la búsqueda, Gate F5). La base
 * acota cada grupo y exige al menos 2 caracteres.
 */
export async function searchSuggestions(
  storeId: string,
  query: string,
): Promise<SearchSuggestions> {
  assertStore(storeId);
  const q = query.trim().slice(0, 60);
  if (q.length < 2) return EMPTY_SUGGESTIONS;
  return (
    (await call<SearchSuggestions>(
      gatewayDb()`select storefront.search_suggestions(${storeId}::uuid, ${q}) as value`,
    )) ?? EMPTY_SUGGESTIONS
  );
}
