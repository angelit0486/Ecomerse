import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { handleMercadoPagoWebhook } from "@/server/payments/mercadopago-webhook";
import { mercadoPagoProvider } from "@/server/payments/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 262_144;

/**
 * Endpoint de webhooks de Mercado Pago (GATE0 §18.4, ADR-028): un solo endpoint de
 * plataforma con su clave secreta (se configura en «Tus integraciones» → Webhooks).
 */
export async function POST(request: Request): Promise<Response> {
  const reqLog = log.child({
    request_id: requestIdFrom(request.headers),
    route: "webhooks.mercadopago",
  });
  const provider = mercadoPagoProvider();
  if (!provider) return Response.json({ received: false }, { status: 404 });
  // Se rechaza por tamaño antes de leer el cuerpo (el límite se vuelve a aplicar al leer).
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ received: false }, { status: 413 });
  }
  const result = await handleMercadoPagoWebhook({
    db: workerDb(),
    provider,
    url: new URL(request.url),
    headers: request.headers,
    rawBody: await request.text(),
    now: new Date(),
    log: reqLog,
    requireLivemode: serverEnv().APP_ENV === "production",
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
