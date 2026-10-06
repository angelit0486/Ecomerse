import "server-only";

import { cache } from "react";
import { z } from "zod";

import { gatewayDb } from "@/server/db/role-clients";

/**
 * Datos públicos de una tienda (storefront.get_store_public, rol
 * storefront_gateway). El store_id viene de la reescritura del proxy, que lo
 * obtiene solo de store_domains; /_store no es accesible desde fuera.
 */
const storePublicSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  handle: z.string(),
  status: z.string(),
  locale: z.string(),
  currency: z.string(),
  country: z.string(),
  // Logo publicado (F3-T06): ruta en store-media, ya re-codificado por el worker.
  logo: z
    .object({ path: z.string(), width: z.number().nullable(), height: z.number().nullable() })
    .nullable()
    .optional(),
});

export type StorePublic = z.infer<typeof storePublicSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const getStorePublic = cache(async (storeId: string): Promise<StorePublic | null> => {
  if (!UUID_RE.test(storeId)) return null;
  const rows = await gatewayDb()<{ store: unknown }[]>`
    select storefront.get_store_public(${storeId}::uuid) as store`;
  const parsed = storePublicSchema.safeParse(rows[0]?.store);
  return parsed.success ? parsed.data : null;
});
