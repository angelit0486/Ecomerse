import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { handleSendEmailHook } from "@/server/notifications/auth-hook";
import { emailChannel } from "@/server/notifications/channel";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";

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
  if (Number(request.headers.get("content-length") ?? 0) > 65_536) {
    return Response.json(
      { error: { http_code: 413, message: "payload_too_large" } },
      { status: 413 },
    );
  }
  const result = await handleSendEmailHook({
    secret,
    headers: request.headers,
    rawBody: await request.text(),
    now: new Date(),
    db: workerDb(),
    channel: emailChannel(),
    log: log.child({ request_id: requestIdFrom(request.headers), route: "auth.email_hook" }),
    otpMinutes: OTP_MINUTES,
  });
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
