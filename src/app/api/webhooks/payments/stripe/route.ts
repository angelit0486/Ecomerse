import { workerDb } from "@/server/db/role-clients";
import { processQueueSoon } from "@/server/jobs/run-now";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { readBodyLimited } from "@/server/security/body";
import { stripeProvider } from "@/server/payments/registry";
import { handleStripeWebhook } from "@/server/payments/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 262_144;

/**
 * Endpoint de webhooks Connect de Stripe (GATE0 §18.4; un solo endpoint de
 * plataforma con su secreto, D-F7-01). El cuerpo se lee crudo: la firma cubre los bytes exactos.
 */
export async function POST(request: Request): Promise<Response> {
  const reqLog = log.child({
    request_id: requestIdFrom(request.headers),
    route: "webhooks.stripe",
  });
  const provider = stripeProvider();
  if (!provider) return Response.json({ received: false }, { status: 404 });
  // Tope real de bytes al leer, no solo por content-length (SEC-07).
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) return Response.json({ received: false }, { status: 413 });
  const result = await handleStripeWebhook({
    db: workerDb(),
    provider,
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
