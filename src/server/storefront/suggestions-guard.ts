import { TtlCache } from "@/server/routing/ttl-cache";

/**
 * Freno de las sugerencias del buscador (auditoría de autorización 2026-11-17,
 * hallazgo 3). La ruta es pública y se llama mientras el comprador escribe; sin
 * freno, un cliente podía ocupar las 3 conexiones del pool del gateway de la
 * instancia y frenar a la vez fichas de producto y checkout de todas las tiendas
 * servidas por ella. Dos límites, ambos POR INSTANCIA (sin migración ni estado
 * compartido; el límite global por IP queda para el WAF de Vercel):
 *   * por IP (hash): 30 sugerencias cada 10 s; el buscador espera a que el
 *     comprador deje de escribir y cancela la anterior, así que una persona
 *     queda muy por debajo;
 *   * en curso a la vez: como mucho 1 consulta de sugerencias por instancia, de
 *     modo que siempre quedan 2 conexiones para páginas y checkout.
 * Al rechazar, la ruta responde 429 con la lista vacía: el buscador ya trata
 * cualquier respuesta no-ok como «sin sugerencias» y Enter sigue buscando.
 */
export const SUGGESTIONS_PER_WINDOW = 30;
export const SUGGESTIONS_WINDOW_MS = 10_000;
export const SUGGESTIONS_MAX_IN_FLIGHT = 1;

export interface SuggestionsGuard {
  /** Reserva un turno; null si hay que rechazar. Llamar a `release` al terminar. */
  take(ipHash: string): { release: () => void } | null;
}

export function createSuggestionsGuard(
  options: {
    perWindow?: number;
    windowMs?: number;
    maxInFlight?: number;
    maxKeys?: number;
    now?: () => number;
  } = {},
): SuggestionsGuard {
  const perWindow = options.perWindow ?? SUGGESTIONS_PER_WINDOW;
  const windowMs = options.windowMs ?? SUGGESTIONS_WINDOW_MS;
  const maxInFlight = options.maxInFlight ?? SUGGESTIONS_MAX_IN_FLIGHT;
  // Ventana fija por IP; el tamaño máximo acota la memoria aunque lleguen muchas IP.
  const counts = new TtlCache<{ n: number }>(options.maxKeys ?? 5_000, options.now);
  let inFlight = 0;

  return {
    take(ipHash) {
      let entry = counts.get(ipHash);
      if (!entry) {
        entry = { n: 0 };
        counts.set(ipHash, entry, windowMs);
      }
      if (entry.n >= perWindow || inFlight >= maxInFlight) return null;
      entry.n += 1;
      inFlight += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          inFlight -= 1;
        },
      };
    },
  };
}
