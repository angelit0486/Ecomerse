import { stripeBilling, handleBillingWebhook } from "@/server/billing/stripe-billing";
import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { readBodyLimited } from "@/server/security/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 262_144;

/**
 * Webhook de Stripe Billing (ADR-044): el cobro de la mensualidad de cada
 * organización. Endpoint y secreto propios, separados del de Connect (pagos de
 * las tiendas). El cuerpo se lee crudo: la firma cubre los bytes exactos.
 */
export async function POST(request: Request): Promise<Response> {
  const config = stripeBilling();
  if (!config) return Response.json({ received: false }, { status: 404 });
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) return Response.json({ received: false }, { status: 413 });
  try {
    const result = await handleBillingWebhook({
      db: workerDb(),
      config,
      signature: request.headers.get("stripe-signature"),
      rawBody,
      now: new Date(),
      requireLivemode: serverEnv().APP_ENV === "production",
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    // Stripe reintenta ante un 500; el evento es idempotente en la base.
    log.error("webhooks.billing_stripe_failed", {
      request_id: requestIdFrom(request.headers),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ received: false }, { status: 500 });
  }
}
