import "server-only";

import { cache } from "react";

import { GOAL_KEY, hasSelection, type AttributeSelection } from "@/lib/catalog/attributes";
import type { BenefitIcon, VideoProvider, Visibility } from "@/lib/theme/constants";
import type { SupplementSheet } from "@/server/catalog/regulatory";
import { gatewayDb, type TransactionSql } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";

import { cachedRead, COMPLIANCE_TAG } from "./cache";
import { isStorePreview } from "./preview-mode";
import { previewCatalogRead } from "./preview-reads";

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
  /** Porciones por envase de la ficha sanitaria (precio por porción en la tarjeta). */
  servings?: number | null;
  /** Borrador visible solo en la vista previa de la tienda (ADR-032): nunca se compra. */
  unpublished?: boolean;
}

export interface ProductPage {
  items: ProductCard[];
  sort: ListSort;
  next_cursor: { k: string | number; id: string } | null;
  /** Total de resultados (solo en la primera página; revisión de conversión, M6). */
  total?: number | null;
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
  /** Rango de precio en centavos sobre el precio desde (super prompt §7). */
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  /** Solo productos con descuento real (precio de comparación mayor que el precio). */
  onSale?: boolean | undefined;
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
  /** Borrador visible solo en la vista previa de la tienda (ADR-032): nunca se compra. */
  unpublished?: boolean;
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
    /** Plazo del proveedor cuando solo él tiene existencias (ADR-025); nunca el proveedor. */
    ships_in_days?: { min: number; max: number } | null;
    /** ADR-026: contenido y porciones de esta presentación (null = los del producto). */
    net_content?: string | null;
    servings_per_container?: number | null;
    /** ADR-030: fin de la oferta con fechas en curso (null sin oferta programada). */
    sale_ends_at?: string | null;
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
  /** Banner ancho (misión Panel, Paso A); falta en bases sin la migración. */
  cover?: ImageRef | null;
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
  /** Misión Portada/Marcas: banner, descripción y sitio (pueden faltar en datos viejos). */
  cover?: ImageRef | null;
  description?: string | null;
  website_url?: string | null;
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
  /** Bloques publicados (o el borrador en la vista previa), ya resueltos (ADR-034 §3). */
  sections?: HomeSectionData[];
  seo_image?: ImageRef | null;
  /** Solo en la vista previa: la página aún no se publica. */
  unpublished?: boolean;
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

/** El pool del gateway o la transacción de la vista previa (ADR-032). */
type Db = ReturnType<typeof gatewayDb> | TransactionSql;

/**
 * Lectura del catálogo (ADR-032): en la vista previa de ESTA tienda incluye sus
 * borradores y nunca pasa por la caché compartida (depende de la cookie de la
 * dueña); fuera de ella, la lectura publicada de siempre.
 */
async function catalogRead<R>(
  storeId: string,
  preview: (db: Db) => Promise<R>,
  published: () => Promise<R>,
): Promise<R> {
  return (await isStorePreview(storeId)) ? previewCatalogRead(storeId, preview) : published();
}

/**
 * Solo se cachea la primera página sin búsqueda ni filtros de atributos:
 * cursores, textos libres y combinaciones de filtros son ilimitados y llenarían
 * la caché con claves de un solo uso (Gate F5).
 */
function cacheable(
  filters: Pick<
    ListFilters,
    "cursor" | "query" | "attributes" | "brands" | "minPrice" | "maxPrice"
  >,
): boolean {
  return (
    !filters.cursor &&
    !filters.query &&
    !(filters.attributes && hasSelection(filters.attributes)) &&
    !filters.brands?.length &&
    filters.minPrice === undefined &&
    filters.maxPrice === undefined
  );
}

function brandsParam(filters: ListFilters): string[] | null {
  return filters.brands?.length ? filters.brands.slice(0, 20) : null;
}

function attributesParam(db: Db, filters: ListFilters) {
  return filters.attributes && hasSelection(filters.attributes)
    ? db.json(filters.attributes)
    : null;
}

export async function listProducts(storeId: string, filters: ListFilters): Promise<ProductPage> {
  assertStore(storeId);
  return catalogRead(
    storeId,
    (db) => readListProducts(storeId, filters, db),
    () =>
      cacheable(filters)
        ? listProductsCached(storeId, filters)
        : readListProducts(storeId, filters),
  );
}

const readListProducts = async (
  storeId: string,
  filters: ListFilters,
  db: Db = gatewayDb(),
): Promise<ProductPage> => {
  const cursor = decodeListCursor(filters.cursor);
  const page = await call<ProductPage>(db`
    select storefront.list_products(
      ${storeId}::uuid, ${filters.categoryPath ?? null}, ${filters.brandSlug ?? null},
      ${filters.query?.slice(0, 200) ?? null}, ${filters.sort ?? null},
      ${filters.minPrice ?? null}::bigint, ${filters.maxPrice ?? null}::bigint,
      ${filters.available ?? false}, ${cursor ? db.json(cursor) : null}::jsonb, ${filters.limit ?? 24},
      ${attributesParam(db, filters)}::jsonb, ${brandsParam(filters)}::text[], ${filters.onSale ?? false}
    ) as value`);
  return page ?? ({ items: [], sort: "newest", next_cursor: null } satisfies ProductPage);
};

const listProductsCached = cachedRead("list_products", (storeId: string, filters: ListFilters) =>
  readListProducts(storeId, filters),
);

/** Filtros con conteo del mismo listado (mismas reglas de caché que el listado). */
export async function listFacets(storeId: string, filters: ListFilters): Promise<Facet[]> {
  assertStore(storeId);
  return catalogRead(
    storeId,
    (db) => readListFacets(storeId, filters, db),
    () =>
      cacheable(filters) ? listFacetsCached(storeId, filters) : readListFacets(storeId, filters),
  );
}

const readListFacets = async (
  storeId: string,
  filters: ListFilters,
  db: Db = gatewayDb(),
): Promise<Facet[]> => {
  return (
    (await call<Facet[]>(db`
      select storefront.list_facets(
        ${storeId}::uuid, ${filters.categoryPath ?? null}, ${filters.brandSlug ?? null},
        ${filters.query?.slice(0, 200) ?? null}, ${filters.available ?? false},
        ${attributesParam(db, filters)}::jsonb, ${brandsParam(filters)}::text[],
        ${filters.minPrice ?? null}::bigint, ${filters.maxPrice ?? null}::bigint, ${filters.onSale ?? false}
      ) as value`)) ?? []
  );
};

const listFacetsCached = cachedRead("list_facets", (storeId: string, filters: ListFilters) =>
  readListFacets(storeId, filters),
);

/** Marca del directorio (super prompt §8): solo con productos publicados. */
export interface BrandSummary {
  slug: string;
  name: string;
  count: number;
  logo: { path: string; width: number | null; height: number | null } | null;
}

export async function listBrands(storeId: string): Promise<BrandSummary[]> {
  assertStore(storeId);
  return (
    (await catalogRead(
      storeId,
      (db) => readBrands(storeId, db),
      () => brandsCached(storeId),
    )) ?? []
  );
}

const readBrands = (storeId: string, db: Db = gatewayDb()) =>
  call<BrandSummary[]>(db`select storefront.list_brands(${storeId}::uuid) as value`);
const brandsCached = cachedRead("list_brands", (storeId: string) => readBrands(storeId));

/** Cuántas marcas y ofertas hay: el menú solo muestra lo que tiene contenido. */
export interface DiscoverySummary {
  brands: number;
  offers: number;
}

export async function getDiscoverySummary(storeId: string): Promise<DiscoverySummary> {
  assertStore(storeId);
  return (
    (await catalogRead(
      storeId,
      (db) => readDiscovery(storeId, db),
      () => discoveryCached(storeId),
    )) ?? { brands: 0, offers: 0 }
  );
}

const readDiscovery = (storeId: string, db: Db = gatewayDb()) =>
  call<DiscoverySummary>(db`select storefront.discovery_summary(${storeId}::uuid) as value`);
const discoveryCached = cachedRead("discovery_summary", (storeId: string) =>
  readDiscovery(storeId),
);

/**
 * Fotos cuadradas de las categorías por ruta (misión Panel, Paso A), para el
 * menú y la barra de categorías. Sin la migración, o si falla, `{}`: se usan
 * las iniciales.
 */
export async function getCategoryThumbs(storeId: string): Promise<Record<string, ImageRef>> {
  assertStore(storeId);
  try {
    return (
      (await catalogRead(
        storeId,
        (db) => readCategoryThumbs(storeId, db),
        () => categoryThumbsCached(storeId),
      )) ?? {}
    );
  } catch {
    return {};
  }
}

const readCategoryThumbs = (storeId: string, db: Db = gatewayDb()) =>
  call<Record<string, ImageRef>>(db`select storefront.category_thumbs(${storeId}::uuid) as value`);
const categoryThumbsCached = cachedRead("category_thumbs", (storeId: string) =>
  readCategoryThumbs(storeId),
);

export const getProduct = cache(
  async (storeId: string, slug: string): Promise<ProductDetail | null> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return null;
    return catalogRead(
      storeId,
      (db) => readProduct(storeId, slug, db),
      () => productCached(storeId, slug),
    );
  },
);

/** «Más para tu objetivo» (F9-T03): comparten objetivo, sabor… y luego categoría. */
export const getRelatedProducts = cache(
  async (storeId: string, slug: string): Promise<ProductCard[]> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return [];
    return (
      (await catalogRead(
        storeId,
        (db) => readRelated(storeId, slug, db),
        () => relatedCached(storeId, slug),
      )) ?? []
    );
  },
);

const readRelated = (storeId: string, slug: string, db: Db = gatewayDb()) =>
  call<ProductCard[]>(
    db`select storefront.related_products(${storeId}::uuid, ${slug}, 8) as value`,
  );
const relatedCached = cachedRead("related_products", (storeId: string, slug: string) =>
  readRelated(storeId, slug),
);

/** Umbral real de envío gratis para el país de la tienda (F9-T03); null si no hay. */
export interface ShippingPromo {
  free_over: number;
  /** Solo en algunas regiones o pesos: la tienda dice «según destino». */
  conditional: boolean;
  /** Costo de esa tarifa cuando no se alcanza el mínimo. */
  price: number;
  est_days_min: number | null;
  est_days_max: number | null;
}

export const getShippingPromo = cache(async (storeId: string): Promise<ShippingPromo | null> => {
  assertStore(storeId);
  return shippingPromoCached(storeId);
});

const shippingPromoCached = cachedRead("shipping_promo", (storeId: string) =>
  call<ShippingPromo>(gatewayDb()`select storefront.shipping_promo(${storeId}::uuid) as value`),
);

/** Opiniones publicadas (ADR-029): solo de compradores verificados y moderadas por la tienda. */
export interface ProductReviews {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  items: {
    rating: number;
    title: string | null;
    body: string;
    author_name: string;
    created_at: string;
  }[];
}

export const getProductReviews = cache(
  async (storeId: string, productId: string): Promise<ProductReviews | null> => {
    assertStore(storeId);
    if (!UUID_RE.test(productId)) return null;
    return reviewsCached(storeId, productId);
  },
);

const reviewsCached = cachedRead("product_reviews", (storeId: string, productId: string) =>
  call<ProductReviews>(
    gatewayDb()`select storefront.product_reviews(${storeId}::uuid, ${productId}::uuid, 10) as value`,
  ),
);

/** Calificación de las tarjetas (ADR-029): solo productos con opiniones publicadas. */
export type RatingSummaries = Record<string, { average: number; count: number }>;

export async function getRatingSummaries(
  storeId: string,
  productIds: string[],
): Promise<RatingSummaries> {
  assertStore(storeId);
  const ids = [...new Set(productIds.filter((id) => UUID_RE.test(id)))].sort().slice(0, 100);
  if (ids.length === 0) return {};
  return (await ratingsCached(storeId, ids.join(","))) ?? {};
}

const ratingsCached = cachedRead("rating_summaries", (storeId: string, ids: string) =>
  call<RatingSummaries>(
    gatewayDb()`select storefront.rating_summaries(${storeId}::uuid, ${ids.split(",")}::uuid[]) as value`,
  ),
);

/**
 * «Agregar» desde la tarjeta (rediseño A+B): por producto, la variante que se
 * agrega directo o null si hay que elegir una opción en la ficha. Un producto
 * ausente no lleva botón. Si la lectura falla (p. ej. una base sin la migración
 * nueva), las tarjetas quedan sin botón y siguen funcionando.
 */
export type CardVariants = Record<string, string | null>;

export async function getCardVariants(
  storeId: string,
  productIds: string[],
): Promise<CardVariants> {
  assertStore(storeId);
  const ids = [...new Set(productIds.filter((id) => UUID_RE.test(id)))].sort().slice(0, 100);
  if (ids.length === 0) return {};
  try {
    return (await cardVariantsCached(storeId, ids.join(","))) ?? {};
  } catch {
    return {};
  }
}

const cardVariantsCached = cachedRead("card_variants", (storeId: string, ids: string) =>
  call<CardVariants>(
    gatewayDb()`select storefront.card_variants(${storeId}::uuid, ${ids.split(",")}::uuid[]) as value`,
  ),
);

const GOAL_VALUE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Foto de cada bloque «¿Qué quieres lograr?» (rediseño A+B): la portada del
 * producto disponible más vendido de cada objetivo. Las claves salen de los
 * filtros de la propia tienda (nunca de la URL), así que la lectura se cachea
 * aunque lleve atributos. Sin foto, el bloque se ve solo con su color.
 */
export async function getGoalCovers(
  storeId: string,
  keys: string[],
): Promise<Record<string, ImageRef | null>> {
  assertStore(storeId);
  const clean = [...new Set(keys.filter((k) => k.length <= 60 && GOAL_VALUE_RE.test(k)))]
    .sort()
    .slice(0, 8);
  if (clean.length === 0) return {};
  try {
    return await catalogRead(
      storeId,
      (db) => readGoalCovers(storeId, clean.join(","), db),
      () => goalCoversCached(storeId, clean.join(",")),
    );
  } catch {
    return {};
  }
}

const readGoalCovers = async (storeId: string, keys: string, db: Db = gatewayDb()) => {
  const pages = await Promise.all(
    keys.split(",").map(async (key) => {
      const page = await readListProducts(
        storeId,
        { attributes: { [GOAL_KEY]: [key] }, sort: "best_selling", available: true, limit: 4 },
        db,
      );
      return [key, page.items.filter((p) => p.image)] as const;
    }),
  );
  // Un producto en varios objetivos no repite foto si el objetivo tiene otro.
  const used = new Set<string>();
  return Object.fromEntries(
    pages.map(([key, items]) => {
      const pick = items.find((p) => !used.has(p.id)) ?? items[0];
      if (pick) used.add(pick.id);
      return [key, pick?.image ?? null] as const;
    }),
  );
};
const goalCoversCached = cachedRead("goal_covers", (storeId: string, keys: string) =>
  readGoalCovers(storeId, keys),
);

const CATEGORY_PATH_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

/**
 * Foto de respaldo de las categorías sin imagen propia (círculos de «Compra por
 * categoría», rediseño A+B): la portada de su producto disponible más vendido.
 * Las rutas salen de la portada configurada por la tienda, nunca de la URL.
 */
export async function getCategoryCovers(
  storeId: string,
  paths: string[],
): Promise<Record<string, ImageRef | null>> {
  assertStore(storeId);
  const clean = [...new Set(paths.filter((p) => p.length <= 200 && CATEGORY_PATH_RE.test(p)))]
    .sort()
    .slice(0, 12);
  if (clean.length === 0) return {};
  try {
    return await catalogRead(
      storeId,
      (db) => readCategoryCovers(storeId, clean.join(","), db),
      () => categoryCoversCached(storeId, clean.join(",")),
    );
  } catch {
    return {};
  }
}

const readCategoryCovers = async (storeId: string, paths: string, db: Db = gatewayDb()) =>
  Object.fromEntries(
    await Promise.all(
      paths.split(",").map(async (path) => {
        const page = await readListProducts(
          storeId,
          { categoryPath: path, sort: "best_selling", available: true, limit: 1 },
          db,
        );
        return [path, page.items[0]?.image ?? null] as const;
      }),
    ),
  );
const categoryCoversCached = cachedRead("category_covers", (storeId: string, paths: string) =>
  readCategoryCovers(storeId, paths),
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
    return catalogRead(
      storeId,
      (db) => readProductRegulatory(storeId, slug, db),
      () => productRegulatoryCached(storeId, slug),
    );
  },
);

export const getProductAttributes = cache(
  async (storeId: string, slug: string): Promise<ProductAttribute[]> => {
    assertStore(storeId);
    if (!SLUG_RE.test(slug) || slug.length > 120) return [];
    return (
      (await catalogRead(
        storeId,
        (db) => readProductAttributes(storeId, slug, db),
        () => productAttributesCached(storeId, slug),
      )) ?? []
    );
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

/**
 * Políticas publicadas para el pie y el pago (auditoría REG-07/UX): se leen las
 * cuatro páginas legales que toda tienda trae (app.create_store_content) por su
 * dirección de origen. Si el comercio cambió esa dirección antes de publicar, la
 * política sigue disponible desde su menú del pie. Nunca se inventa texto: solo
 * se enlaza lo que la tienda publicó.
 */
export const POLICY_SLUGS = [
  ["policy_privacy", "aviso-de-privacidad"],
  ["policy_terms", "terminos-y-condiciones"],
  ["policy_returns", "devoluciones"],
  ["policy_shipping", "envios"],
] as const;

export interface PolicyLink {
  type: (typeof POLICY_SLUGS)[number][0];
  title: string;
  href: string;
}

export const getPolicyLinks = cache(async (storeId: string): Promise<PolicyLink[]> => {
  assertStore(storeId);
  const pages = await Promise.all(POLICY_SLUGS.map(([, slug]) => pageCached(storeId, slug)));
  return POLICY_SLUGS.flatMap(([type], i) => {
    const page = pages[i];
    if (!page || page.type !== type || page.unpublished) return [];
    return [{ type, title: page.title, href: `/paginas/${page.slug}` }];
  });
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

/** Una sección de la portada ya resuelta por la base (app.home_resolve, F9-T02 y ADR-034). */
type SectionBody =
  | {
      type: "hero";
      heading: string;
      subheading?: string | null;
      align: "left" | "center";
      cta?: { label: string; link: string } | null;
      image: ImageRef | null;
      /** Tema v3 (pueden faltar en datos resueltos antes de la migración). */
      mobile_image?: ImageRef | null;
      layout?: "split" | "background";
      autoplay?: boolean;
      slides?: {
        heading: string;
        subheading?: string | null;
        cta?: { label: string; link: string } | null;
        image: ImageRef | null;
        mobile_image: ImageRef | null;
      }[];
    }
  | {
      type: "featured_products";
      title: string;
      show_view_all: boolean;
      layout?: "grid" | "carousel";
      source:
        | { type: "newest" | "best_selling" | "manual" }
        | { type: "category"; path: string }
        | { type: "brand"; slug: string }
        | { type: "attribute_value"; attribute: string; value: string };
      items: ProductCard[];
    }
  | {
      type: "category_grid";
      title: string;
      layout?: "grid" | "carousel";
      categories: { name: string; path: string; image: ImageRef | null }[];
    }
  | {
      type: "promo_banner";
      heading?: string;
      text?: string;
      cta?: { label: string; link: string };
      image: ImageRef;
    }
  | {
      type: "image_with_text";
      heading: string;
      body: string;
      cta?: { label: string; link: string };
      image_position: "left" | "right";
      image: ImageRef;
    }
  | {
      type: "brand_logos";
      title: string;
      /** Tema v4: `logo` null = la marca no tiene logo (se ven sus iniciales). */
      brands: { name: string; slug: string; logo: Omit<ImageRef, "alt"> | null }[];
    }
  | {
      type: "testimonials";
      title: string;
      items: { quote: string; author: string; detail?: string }[];
    }
  | { type: "rich_text"; heading?: string; html: string }
  | { type: "faq"; title: string; items: { question: string; answer: string }[] }
  | {
      type: "benefits";
      title?: string;
      items: { icon: BenefitIcon; title: string; text?: string }[];
    }
  | { type: "goals"; title: string; goals: { label: string; attribute: string; value: string }[] }
  | {
      type: "reviews";
      title: string;
      reviews: {
        rating: number;
        title: string | null;
        body: string;
        author_name: string;
        created_at: string;
        product: { title: string; slug: string };
      }[];
    }
  | { type: "video"; provider: VideoProvider; video_id: string; title: string; caption?: string }
  | { type: "contact_map"; title: string; show_whatsapp: boolean };

export type HomeSectionData = SectionBody & {
  id: string;
  visibility?: Visibility;
  /** Tema v4: colores propios del bloque y espacio arriba y abajo. */
  colors?: { background: string; foreground: string };
  spacing?: "compact" | "normal" | "spacious";
};

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

const readProduct = (storeId: string, slug: string, db: Db = gatewayDb()) =>
  call<ProductDetail>(db`select storefront.get_product(${storeId}::uuid, ${slug}) as value`);
const productCached = cachedRead("get_product", (storeId: string, slug: string) =>
  readProduct(storeId, slug),
);
const readProductRegulatory = (storeId: string, slug: string, db: Db = gatewayDb()) =>
  call<ProductRegulatory>(
    db`select storefront.get_product_regulatory(${storeId}::uuid, ${slug}) as value`,
  );
const productRegulatoryCached = cachedRead(
  "get_product_regulatory",
  (storeId: string, slug: string) => readProductRegulatory(storeId, slug),
  [COMPLIANCE_TAG],
);
const readProductAttributes = (storeId: string, slug: string, db: Db = gatewayDb()) =>
  call<ProductAttribute[]>(
    db`select storefront.get_product_attributes(${storeId}::uuid, ${slug}) as value`,
  );
const productAttributesCached = cachedRead(
  "get_product_attributes",
  (storeId: string, slug: string) => readProductAttributes(storeId, slug),
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

/**
 * Sugerencias del buscador (F9-T04): lo publicado que coincide con lo escrito
 * (en la vista previa, también los borradores, ADR-032).
 */
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
  const read = (db: Db) =>
    call<SearchSuggestions>(
      db`select storefront.search_suggestions(${storeId}::uuid, ${q}) as value`,
    );
  return (await catalogRead(storeId, read, () => read(gatewayDb()))) ?? EMPTY_SUGGESTIONS;
}
