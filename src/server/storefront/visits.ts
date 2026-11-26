import "server-only";

import { gatewayDb } from "@/server/db/role-clients";

import { withConnectionRetry } from "./cache";

/**
 * Suma un visitante del día a la tienda (storefront.record_visit). La tienda sale
 * de la firma del proxy (storefrontForRoute), nunca del navegador; la base solo
 * cuenta tiendas publicadas y el día en su zona horaria.
 */
export async function recordVisit(storeId: string): Promise<void> {
  await withConnectionRetry("record_visit", async () => {
    await gatewayDb()`select storefront.record_visit(${storeId}::uuid)`;
  });
}
