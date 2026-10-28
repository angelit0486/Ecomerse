import { workerDb } from "@/server/db/role-clients";
import { processQueueSoon } from "@/server/jobs/run-now";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { readBodyLimited } from "@/server/security/body";
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
  // Tope real de bytes al leer, no solo por content-length (SEC-07).
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) return Response.json({ received: false }, { status: 413 });
  const result = await handleMercadoPagoWebhook({
    db: workerDb(),
    provider,
    url: new URL(request.url),
    headers: request.headers,
    rawBody,
    now: new Date(),
    log: reqLog,
    requireLivemode: serverEnv().APP_ENV === "production",
  });
  // Lo que encadena el pago (correos, despachos) corre ya, no en la pasada del cron (DIN-04).
  if (result.status === 200) processQueueSoon("webhook.payment");
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
