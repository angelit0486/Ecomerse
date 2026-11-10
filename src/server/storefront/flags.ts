import "server-only";

import { cache } from "react";

import { gatewayDb } from "@/server/db/role-clients";

/**
 * Interruptores por tienda (misión de mejoras, regla 6): los cambios que ve el
 * comprador se encienden tienda por tienda y nacen apagados.
 *
 * - Una consulta por request (memoizada con `cache` de React dentro del request),
 *   en paralelo con las demás lecturas del marco de la tienda.
 * - Sin caché entre requests: encender o apagar surte efecto en la siguiente visita.
 * - Si la lectura falla (red, función o tabla inexistente), todo queda apagado:
 *   la tienda se comporta exactamente como antes de los interruptores.
 */
export type StorefrontFlag =
  | "storefront_nav_scroll_fix"
  | "checkout_shipping_messages"
  | "mobile_input_size"
  // Tema v5 (ADR-063): sin él, la personalidad guardada no se dibuja.
  | "theme_personality";

export async function readStoreFlags(
  query: () => Promise<ReadonlyArray<{ key: string; enabled: boolean }>>,
): Promise<ReadonlySet<StorefrontFlag>> {
  try {
    const rows = await query();
    return new Set(rows.filter((r) => r.enabled === true).map((r) => r.key as StorefrontFlag));
  } catch {
    return new Set();
  }
}

export const storeFlags = cache((storeId: string) =>
  readStoreFlags(
    () => gatewayDb()<{ key: string; enabled: boolean }[]>`
      select key, enabled from storefront.get_store_flags(${storeId}::uuid)`,
  ),
);
