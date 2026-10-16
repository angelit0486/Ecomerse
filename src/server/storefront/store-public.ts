import "server-only";

import { cache } from "react";
import { z } from "zod";

import { gatewayDb } from "@/server/db/role-clients";

import { cachedRead } from "./cache";

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
  // Apertura de la tienda: lo publicado después cuenta como «Nuevo» (revisión M8).
  launched_at: z.string().nullable().optional(),
  // Dominio primario activo: canonical, Open Graph, JSON-LD y sitemap (§22).
  primary_hostname: z.string().nullable().optional(),
  // Tema publicado (nunca el borrador); validado en la base (theme_settings_valid).
  theme: z
    // Sin fila de tema, la base devuelve key/version null: se usan los defaults (§38 F5).
    .object({
      key: z.string().nullable(),
      version: z.number().nullable(),
      settings: z.record(z.string(), z.unknown()),
      published_at: z.string().nullable().optional(),
      // Solo en la vista previa del borrador (preview-reads.ts).
      revision: z.number().nullable().optional(),
    })
    .optional(),
  // Contacto comercial (§20.2); WhatsApp, dirección y horario van en el tema.
  contact: z.object({ email: z.string().optional(), phone: z.string().optional() }).optional(),
  // Imagen social del SEO global (§20.2).
  seo_image: z
    .object({
      path: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      alt: z.string().nullable(),
    })
    .nullable()
    .optional(),
  // Logo publicado (F3-T06): ruta en store-media, ya re-codificado por el worker.
  logo: z
    .object({ path: z.string(), width: z.number().nullable(), height: z.number().nullable() })
    .nullable()
    .optional(),
});

export type StorePublic = z.infer<typeof storePublicSchema>;

/** Valida la forma de lo que devuelve la base (pública o vista previa). */
export function parseStorePublic(value: unknown): StorePublic | null {
  const parsed = storePublicSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const getStorePublic = cache(async (storeId: string): Promise<StorePublic | null> => {
  if (!UUID_RE.test(storeId)) return null;
  return parseStorePublic(await readStorePublic(storeId));
});

const readStorePublic = cachedRead("get_store_public", async (storeId: string) => {
  const rows = await gatewayDb()<{ store: unknown }[]>`
    select storefront.get_store_public(${storeId}::uuid) as store`;
  return rows[0]?.store ?? null;
});
