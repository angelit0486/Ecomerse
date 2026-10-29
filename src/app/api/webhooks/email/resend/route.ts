import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import {
  applyEmailEvent,
  parseEmailEvent,
  verifySvixSignature,
} from "@/server/notifications/email-events";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { readBodyLimited } from "@/server/security/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536;

/**
 * Rebotes y quejas de Resend: el correo queda suprimido (ya no se le escribe).
 * Sin RESEND_WEBHOOK_SECRET el endpoint no existe (404).
 */
export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ received: false }, { status: 404 });
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) return Response.json({ received: false }, { status: 413 });
  const id = request.headers.get("svix-id");
  const ok = verifySvixSignature({
    secret,
    id,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    rawBody,
    now: new Date(),
  });
  const db = workerDb();
  if (!ok) {
    await db`select system.record_webhook_rejection('email.webhook_signature', 'resend')`;
    return Response.json({ received: false }, { status: 401 });
  }
  try {
    const event = parseEmailEvent(rawBody, id!);
    if (event) await applyEmailEvent(db, event);
    return Response.json(
      { received: true, outcome: event ? event.kind : "ignored" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    log.error("webhooks.email_resend_failed", {
      request_id: requestIdFrom(request.headers),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ received: false }, { status: 500 });
  }
}
