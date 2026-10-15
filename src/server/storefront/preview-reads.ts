import "server-only";

import { cache } from "react";

import { gatewayDb } from "@/server/db/role-clients";

import type { HomeData } from "./catalog";
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

/** Portada del borrador (secciones resueltas con los mismos filtros públicos). */
export const getHomePreview = cache(async (storeId: string): Promise<HomeData> => {
  if (!UUID_RE.test(storeId)) return { sections: null, featured: [], categories: [] };
  const rows = await gatewayDb()<{ home: HomeData | null }[]>`
    select storefront.get_home_preview(${storeId}::uuid) as home`;
  return rows[0]?.home ?? { sections: null, featured: [], categories: [] };
});
