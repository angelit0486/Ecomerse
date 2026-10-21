import "server-only";

import { gatewayDb } from "@/server/db/role-clients";
import { TtlCache } from "@/server/routing/ttl-cache";

/**
 * Redirecciones 301 de la tienda (D-EST-02). El mapa completo de cada tienda
 * (≤ 500) se lee con el rol storefront_gateway y se guarda 60 s por instancia,
 * igual que host → tienda: un cambio tarda como mucho un minuto en verse.
 */
const TTL_MS = 60_000;
const cache = new TtlCache<ReadonlyMap<string, string>>(2_000);

/** La ruta como la guarda la base: minúsculas y sin barra final (salvo «/»). */
export function redirectKey(pathname: string): string {
  const lower = pathname.toLowerCase();
  return lower.length > 1 ? lower.replace(/\/+$/, "") : lower;
}

export async function findRedirect(storeId: string, pathname: string): Promise<string | null> {
  let map = cache.get(storeId);
  if (!map) {
    const rows = await gatewayDb()<{ from_path: string; to_path: string }[]>`
      select from_path, to_path from storefront.store_redirects(${storeId})`;
    map = new Map(rows.map((r) => [r.from_path, r.to_path]));
    cache.set(storeId, map, TTL_MS);
  }
  return map.get(redirectKey(pathname)) ?? null;
}
