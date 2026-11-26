import { shouldCountVisit } from "@/lib/storefront/visit-filter";
import { log } from "@/server/observability/logger";
import { clientIpHash } from "@/server/storefront/cart";
import { storefrontForRoute } from "@/server/storefront/context";
import { createSuggestionsGuard } from "@/server/storefront/suggestions-guard";
import { recordVisit } from "@/server/storefront/visits";

/**
 * Aviso de visita (Visitantes de la tienda, 2026-11-26). El navegador lo manda
 * una vez al día por tienda (visit-beacon.tsx). Siempre responde 204 sin cuerpo:
 * el comprador nunca ve nada ni espera por esto, y un fallo solo deja una visita
 * sin contar (queda en el log).
 */
type Params = { params: Promise<{ storeId: string }> };

// Por instancia: 5 avisos por IP por minuto y uno a la vez, para no ocupar las
// conexiones que necesitan las páginas y el checkout (como las sugerencias).
const guard = createSuggestionsGuard({ perWindow: 5, windowMs: 60_000, maxInFlight: 1 });

const done = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const turn = guard.take(await clientIpHash());
  if (!turn) return done();
  try {
    const resolved = await storefrontForRoute((await params).storeId, request.headers);
    if (!resolved) return done();
    const count = shouldCountVisit({
      userAgent: request.headers.get("user-agent"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      preview: resolved.preview,
    });
    if (count) await recordVisit(resolved.store.id);
  } catch (error) {
    log.warn("storefront.visit_not_recorded", {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error),
    });
  } finally {
    turn.release();
  }
  return done();
}
