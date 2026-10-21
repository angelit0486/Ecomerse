import "server-only";

import { cache } from "react";

import { gatewayDb, type TransactionSql } from "@/server/db/role-clients";

import type { HomeData, PageDetail } from "./catalog";
import { parseStorePublic, type StorePublic, UUID_RE } from "./store-public";

/**
 * Lecturas del BORRADOR para la vista previa (F9-DESIGN §5 y §13 M8, D-F9-02).
 * Nunca pasan por `cachedRead` ni por `unstable_cache`: dependen de la cookie de
 * vista previa del request y no deben llegar a la caché compartida de la tienda
 * (una prueba lo verifica). Solo se llaman cuando el proxy firmó el request como
 * vista previa de ESTA tienda.
 */
export const getStorePreview = cache(async (storeId: string): Promise<StorePublic | null> => {
  if (!UUID_RE.test(storeId)) return null;
  const rows = await gatewayDb()<{ store: unknown }[]>`
    select storefront.get_store_preview(${storeId}::uuid) as store`;
  return parseStorePublic(rows[0]?.store ?? null);
});

/**
 * Catálogo con los productos en borrador de la tienda (ADR-032): una transacción
 * del gateway con `pruva.preview_store` LOCAL (`set_config(…, true)`). Se descarta
 * al terminar la transacción, así que nunca queda en una conexión del pool ni la
 * ve otra lectura.
 */
export async function previewCatalogRead<T>(
  storeId: string,
  read: (db: TransactionSql) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(storeId)) throw new Error("storeId inválido");
  return (await gatewayDb().begin(async (tx) => {
    await tx`select set_config('pruva.preview_store', ${storeId}, true)`;
    return read(tx);
  })) as T;
}

/** Portada del borrador (secciones resueltas con los mismos filtros, más los borradores). */
export const getHomePreview = cache(async (storeId: string): Promise<HomeData> => {
  if (!UUID_RE.test(storeId)) return { sections: null, featured: [], categories: [] };
  const rows = await previewCatalogRead(
    storeId,
    (db) => db<{ home: HomeData | null }[]>`
      select storefront.get_home_preview(${storeId}::uuid) as home`,
  );
  return rows[0]?.home ?? { sections: null, featured: [], categories: [] };
});

/** Página con su borrador de bloques (ADR-034 §3); también si aún no se publica. */
export const getPagePreview = cache(
  async (storeId: string, slug: string): Promise<PageDetail | null> => {
    if (!UUID_RE.test(storeId) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
      return null;
    }
    const rows = await previewCatalogRead(
      storeId,
      (db) => db<{ page: PageDetail | null }[]>`
        select storefront.get_page(${storeId}::uuid, ${slug}) as page`,
    );
    return rows[0]?.page ?? null;
  },
);
