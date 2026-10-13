import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

/**
 * Caché de las lecturas públicas por tags (GATE0 §21.4, D-F5-04). Las páginas
 * del storefront siguen siendo dinámicas (nonce de CSP por request); lo que se
 * cachea son los datos, con el storeId en la clave y en el tag: una tienda nunca
 * recibe datos de otra. Las mutaciones del panel invalidan `store:{id}`; el TTL
 * es la red de seguridad (p. ej. disponibilidad tras una venta).
 */
export const STOREFRONT_TTL_SECONDS = 60;

export function storeTag(storeId: string): string {
  return `store:${storeId}`;
}

/** Envuelve una lectura pública cuyo primer argumento es el storeId. */
export function cachedRead<A extends [string, ...unknown[]], R>(
  name: string,
  read: (...args: A) => Promise<R>,
  extraTags: readonly string[] = [],
): (...args: A) => Promise<R> {
  return (...args: A) =>
    unstable_cache(read, ["storefront", name, args[0]], {
      tags: [storeTag(args[0]), ...extraTags],
      revalidate: STOREFRONT_TTL_SECONDS,
    })(...args);
}

/** Invalida todo lo cacheado de una tienda (catálogo, contenido, tema, inventario). */
export function invalidateStore(storeId: string): void {
  revalidateTag(storeTag(storeId), { expire: 0 });
}

/** Las leyendas salen de las reglas de la plataforma: un cambio llega a todas las tiendas. */
export const COMPLIANCE_TAG = "storefront:compliance";

export function invalidateCompliance(): void {
  revalidateTag(COMPLIANCE_TAG, { expire: 0 });
}
