import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

import { log } from "@/server/observability/logger";

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

/**
 * Errores de *conexión* (no de la consulta): la lectura nunca llegó a correr.
 * En producción, a ratos una conexión nueva al pooler (Supavisor) no responde a
 * tiempo aunque la base esté sana (registros de Vercel, 2026-11-22 a 26); una
 * segunda conexión casi siempre entra. Un error de la consulta (p. ej.
 * `statement timeout`, 57014) no se repite: duplicaría la carga.
 */
const CONNECTION_ERRORS = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECTION_ERRORS.has(code);
}

/**
 * Una lectura pública (solo lee: repetirla es seguro) con un reintento si falló
 * la conexión. Sin esto, un tropiezo dejaba la copia vieja en caché (el precio
 * «tardaba» en cambiar) o mostraba la página de error.
 */
export async function withConnectionRetry<R>(name: string, read: () => Promise<R>): Promise<R> {
  try {
    return await read();
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    log.warn("storefront.read_retry", { read: name, code: (error as { code: string }).code });
    return read();
  }
}

/** Envuelve una lectura pública cuyo primer argumento es el storeId. */
export function cachedRead<A extends [string, ...unknown[]], R>(
  name: string,
  read: (...args: A) => Promise<R>,
  extraTags: readonly string[] = [],
): (...args: A) => Promise<R> {
  const resilient = (...args: A) => withConnectionRetry(name, () => read(...args));
  return (...args: A) =>
    unstable_cache(resilient, ["storefront", name, args[0]], {
      tags: [storeTag(args[0]), ...extraTags],
      revalidate: STOREFRONT_TTL_SECONDS,
    })(...args);
}

/**
 * Invalidar es de mejor esfuerzo. La cola también corre después de responder
 * una acción o al mirar una página (`after()`), y ahí Next puede negarse
 * («can't be called during render»). Un trabajo que ya terminó su parte no debe
 * fallar ni repetirse por eso (hallazgo del ensayo, Orden 10, mensaje 4): el TTL
 * de 60 s sigue siendo la red de seguridad.
 */
function revalidate(tag: string): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (error) {
    log.warn("storefront.cache_invalidation_skipped", {
      tag,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
  }
}

/** Invalida todo lo cacheado de una tienda (catálogo, contenido, tema, inventario). */
export function invalidateStore(storeId: string): void {
  revalidate(storeTag(storeId));
}

/** Las leyendas salen de las reglas de la plataforma: un cambio llega a todas las tiendas. */
export const COMPLIANCE_TAG = "storefront:compliance";

export function invalidateCompliance(): void {
  revalidate(COMPLIANCE_TAG);
}
