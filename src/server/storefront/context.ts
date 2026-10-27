import "server-only";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { serverEnv } from "@/server/env";

import { STORE_ROUTE_HEADER, verifyStoreRoute } from "./route-signature";
import { getStorePreview } from "./preview-reads";
import { setMediaVariantsReady } from "./media-variants";
import { getStorePublic, type StorePublic } from "./store-public";

/**
 * Tienda del request en el storefront: solo si el proxy enrutó ESTA tienda en
 * este request (firma HMAC) y su estado permite servirla (borrador solo con
 * vista previa). Si no, 404. Memoizada por request (§44.7).
 */
export const getStorefront = cache(
  async (storeId: string): Promise<{ store: StorePublic; preview: boolean }> => {
    const route = verifyStoreRoute(
      serverEnv().PREVIEW_HMAC_SECRET,
      storeId,
      (await headers()).get(STORE_ROUTE_HEADER),
    );
    if (!route) notFound();
    // En vista previa, el tema y el logo del borrador (sin caché, §5).
    const store = route.preview ? await getStorePreview(storeId) : await getStorePublic(storeId);
    if (!store || (store.status !== "active" && !(store.status === "draft" && route.preview)))
      notFound();
    setMediaVariantsReady(store.media_variants === true);
    return { store, preview: route.preview };
  },
);

/** Igual que getStorefront para Route Handlers: null en lugar de notFound(). */
export async function storefrontForRoute(
  storeId: string,
  requestHeaders: Headers,
): Promise<{ store: StorePublic; preview: boolean } | null> {
  const route = verifyStoreRoute(
    serverEnv().PREVIEW_HMAC_SECRET,
    storeId,
    requestHeaders.get(STORE_ROUTE_HEADER),
  );
  if (!route) return null;
  const store = route.preview ? await getStorePreview(storeId) : await getStorePublic(storeId);
  if (!store || (store.status !== "active" && !(store.status === "draft" && route.preview)))
    return null;
  return { store, preview: route.preview };
}
