import { createHash } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import type { Logger } from "@/server/observability/logger";
import { verifyStandardWebhook } from "@/server/security/standard-webhooks";

import { alreadyDelivered, sendNotification } from "./handlers";
import { authCodeEmail, type AuthEmailBrand } from "./templates";
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

interface IntentBrand {
  name: string;
  logo_path: string | null;
  primary_color: string | null;
}

interface HookPayload {
  user?: { email?: unknown; new_email?: unknown };
  email_data?: {
    token?: unknown;
    token_new?: unknown;
    email_action_type?: unknown;
    redirect_to?: unknown;
  };
}

const CODE_RE = /^\d{6,10}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

/** Nonce del intento de acceso de la tienda (`?pruva_login=` en redirect_to). */
export function loginNonce(redirectTo: unknown): string | null {
  if (typeof redirectTo !== "string" || redirectTo.length > 2000) return null;
  try {
    const nonce = new URL(redirectTo).searchParams.get("pruva_login");
    return nonce && NONCE_RE.test(nonce) ? nonce : null;
  } catch {
    return null;
  }
}
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
  /** URL pública de un objeto de store-media (logo de la tienda). */
  mediaUrl?: (path: string) => string;
}): Promise<AuthHookResult> {
  if (deps.rawBody.length > 65_536) return error(413, "payload_too_large");
  const verified = verifyStandardWebhook({
    secret: deps.secret,
    headers: deps.headers,
    body: deps.rawBody,
    nowSeconds: Math.floor(deps.now.getTime() / 1000),
  });
  if (!verified.ok) {
    await deps.db`select system.record_webhook_rejection(${`auth.email_hook_${verified.reason}`}, 'supabase_auth')`;
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

  // Cambio de email (verificado en el código de Supabase Auth, internal/api/mail.go):
  // seguro → `token` al email actual y `token_new` al nuevo; sin cambio seguro, el
  // único `token` es del email NUEVO.
  const sends: { to: unknown; code: unknown }[] = [];
  if (action === "email_change") {
    if (payload.email_data?.token_new) {
      sends.push({ to: payload.user?.email, code: payload.email_data?.token });
      sends.push({ to: payload.user?.new_email, code: payload.email_data.token_new });
    } else {
      sends.push({ to: payload.user?.new_email, code: payload.email_data?.token });
    }
  } else {
    sends.push({ to: payload.user?.email, code: payload.email_data?.token });
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
    // Marca de la tienda SOLO si esta petición de código la registró el servidor de
    // esa tienda (nonce en redirect_to, Gate F8): el login del panel o una llamada
    // directa a Auth nunca reciben la marca de otra tienda.
    const nonce = loginNonce(payload.email_data?.redirect_to);
    const [intent] =
      nonce && (action === "magiclink" || action === "signup")
        ? await deps.db<{ b: IntentBrand | null }[]>`
            select system.login_intent_store(${(sends[0] as { to: string }).to}, ${nonce}) as b`
        : [];
    const brand: AuthEmailBrand | null = intent?.b
      ? {
          name: intent.b.name,
          logoUrl: intent.b.logo_path && deps.mediaUrl ? deps.mediaUrl(intent.b.logo_path) : null,
          primaryColor: intent.b.primary_color,
        }
      : null;
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
            brand,
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
