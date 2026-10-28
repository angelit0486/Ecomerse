import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { handleSendEmailHook } from "@/server/notifications/auth-hook";
import { emailChannel } from "@/server/notifications/channel";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";
import { readBodyLimited } from "@/server/security/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vigencia de los códigos (Auth: MAILER_OTP_EXP = 600 s). Solo se muestra en el email. */
const OTP_MINUTES = 10;

/**
 * Send Email Hook de Supabase Auth (F7-T04b, D-F7-07). Sin secreto configurado
 * el endpoint no existe y Auth usa su propio SMTP.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv().SEND_EMAIL_HOOK_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  // Tope real de bytes al leer, no solo por content-length (SEC-07).
  const rawBody = await readBodyLimited(request, 65_536);
  if (rawBody === null) {
    return Response.json(
      { error: { http_code: 413, message: "payload_too_large" } },
      { status: 413 },
    );
  }
  const result = await handleSendEmailHook({
    secret,
    headers: request.headers,
    rawBody,
    now: new Date(),
    db: workerDb(),
    channel: emailChannel(),
    log: log.child({ request_id: requestIdFrom(request.headers), route: "auth.email_hook" }),
    otpMinutes: OTP_MINUTES,
    mediaUrl: (path) =>
      `${serverEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/store-media/${path}`,
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
