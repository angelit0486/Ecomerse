import "server-only";

import { gatewayDb } from "@/server/db/role-clients";
import type { HostResolution } from "@/server/routing/storefront-decision";
import { TtlCache } from "@/server/routing/ttl-cache";

/**
 * host → tienda vía `storefront.resolve_host` (rol storefront_gateway) con caché
 * por instancia (GATE0 §21.1: TTL 60 s). Los hosts desconocidos se cachean menos
 * para que una tienda nueva aparezca pronto.
 */
const FOUND_TTL_MS = 60_000;
const MISSING_TTL_MS = 10_000;
const cache = new TtlCache<HostResolution | null>(5_000);

interface ResolveRow {
  store_id: string;
  store_status: HostResolution["status"];
  primary_hostname: string | null;
  is_primary: boolean;
}

export async function resolveHost(host: string): Promise<HostResolution | null> {
  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  const rows = await gatewayDb()<ResolveRow[]>`select * from storefront.resolve_host(${host})`;
  const row = rows[0];
  const resolution: HostResolution | null = row
    ? {
        storeId: row.store_id,
        status: row.store_status,
        primaryHostname: row.primary_hostname,
        isPrimary: row.is_primary,
      }
    : null;
  cache.set(host, resolution, resolution ? FOUND_TTL_MS : MISSING_TTL_MS);
  return resolution;
}
