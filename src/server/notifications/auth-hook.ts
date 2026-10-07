import { createHash } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import type { Logger } from "@/server/observability/logger";
import { verifyStandardWebhook } from "@/server/security/standard-webhooks";

import { alreadyDelivered, sendNotification } from "./handlers";
import { authCodeEmail } from "./templates";
import { isEmail, type EmailChannel } from "./types";

/**
 * Send Email Hook de Supabase Auth (F7-T04b): Auth delega el envío de sus
 * códigos en la plataforma, que los manda por el mismo canal y con las mismas
 * plantillas que el resto (D-F7-07). Firma Standard Webhooks; un reintento de
 * Auth con el mismo webhook-id no reenvía. Nunca se registra el código ni el
 * email.
 */
export interface AuthHookResult {
  status: number;
  body: Record<string, unknown>;
}

interface HookPayload {
  user?: { email?: unknown; new_email?: unknown };
  email_data?: { token?: unknown; token_new?: unknown; email_action_type?: unknown };
}

const CODE_RE = /^\d{6,10}$/;
const ACTION_RE = /^[a-z_]{1,40}$/;

function error(status: number, message: string): AuthHookResult {
  return { status, body: { error: { http_code: status, message } } };
}

export async function handleSendEmailHook(deps: {
  secret: string;
  headers: Headers;
  rawBody: string;
  now: Date;
  db: Sql;
  channel: EmailChannel;
  log: Logger;
  otpMinutes: number;
}): Promise<AuthHookResult> {
  if (deps.rawBody.length > 65_536) return error(413, "payload_too_large");
  const verified = verifyStandardWebhook({
    secret: deps.secret,
    headers: deps.headers,
    body: deps.rawBody,
    nowSeconds: Math.floor(deps.now.getTime() / 1000),
  });
  if (!verified.ok) {
    await deps.db`select system.record_security_event(${`auth.email_hook_${verified.reason}`}, 'warning',
                                                      null, null, null, null, null, null)`;
    return error(401, "invalid_signature");
  }
  let payload: HookPayload;
  try {
    payload = JSON.parse(deps.rawBody) as HookPayload;
  } catch {
    return error(400, "malformed");
  }
  const action = String(payload.email_data?.email_action_type ?? "");
  if (!ACTION_RE.test(action)) return error(400, "malformed");

  // Cambio de email seguro: un código al email actual y otro al nuevo.
  const sends: { to: unknown; code: unknown }[] = [
    { to: payload.user?.email, code: payload.email_data?.token },
  ];
  if (action === "email_change" && payload.email_data?.token_new) {
    sends.push({ to: payload.user?.new_email, code: payload.email_data.token_new });
  }
  for (const s of sends) {
    if (
      typeof s.to !== "string" ||
      !isEmail(s.to) ||
      typeof s.code !== "string" ||
      !CODE_RE.test(s.code)
    ) {
      return error(400, "malformed");
    }
  }
  try {
    for (const s of sends as { to: string; code: string }[]) {
      const recipient = createHash("sha256").update(s.to.toLowerCase()).digest("hex").slice(0, 16);
      const dedupeKey = `auth_hook:${verified.id}:${recipient}`;
      if (await alreadyDelivered(deps.db, dedupeKey)) continue;
      await sendNotification(
        { db: deps.db, channel: deps.channel },
        {
          dedupeKey,
          template: "auth_code",
          organizationId: null,
          idempotencyKey: dedupeKey,
          message: authCodeEmail({
            to: s.to,
            code: s.code,
            action,
            expiresMinutes: deps.otpMinutes,
          }),
        },
      );
    }
  } catch (cause) {
    deps.log.error("No se pudo enviar el email de Auth", { action, error: cause });
    return error(500, "delivery_failed");
  }
  return { status: 200, body: {} };
}
