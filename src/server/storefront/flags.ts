import "server-only";

import { cache } from "react";

import { gatewayDb } from "@/server/db/role-clients";

/**
 * Interruptores por tienda (misión de mejoras, regla 6): los cambios que ve el
 * comprador se encienden tienda por tienda y nacen apagados. Se leen una vez por
 * request (sin caché entre requests: encender o apagar surte efecto al instante).
 * Si la lectura falla, todo queda apagado: la tienda sigue como antes.
 */
export type StorefrontFlag = "storefront_nav_scroll_fix";

export const storeFlags = cache(async (storeId: string): Promise<ReadonlySet<StorefrontFlag>> => {
  try {
    const rows = await gatewayDb()<{ key: string; enabled: boolean }[]>`
      select key, enabled from storefront.get_store_flags(${storeId}::uuid)`;
    return new Set(rows.filter((r) => r.enabled).map((r) => r.key as StorefrontFlag));
  } catch {
    return new Set();
  }
});
