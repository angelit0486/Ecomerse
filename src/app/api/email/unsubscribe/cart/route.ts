import { serverEnv } from "@/server/env";
import { verifyOptout } from "@/server/notifications/cart-recovery-links";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { optOutCartRecovery } from "@/server/storefront/cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Baja en un clic de los recordatorios de carrito (RFC 8058, reglas de Gmail y
 * Yahoo para remitentes masivos). El cliente de correo hace POST a esta URL;
 * la firma HMAC del enlace prueba que salió de un correo nuestro.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const store = url.searchParams.get("store") ?? "";
  const hash = url.searchParams.get("h");
  const signature = url.searchParams.get("s");
  if (
    !UUID_RE.test(store) ||
    !verifyOptout(serverEnv().ORDER_LINK_SECRET, store, hash, signature)
  ) {
    return Response.json({ ok: false }, { status: 400 });
  }
  try {
    await optOutCartRecovery(store, hash);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    log.error("email.unsubscribe_failed", {
      request_id: requestIdFrom(request.headers),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
