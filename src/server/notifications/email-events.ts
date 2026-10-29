import { createHmac } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import { constantTimeEqual } from "@/server/security/hmac";

/**
 * Rebotes y quejas del proveedor de correo (misión pagos, 2026-10-29). Resend
 * firma sus webhooks con el esquema de Svix: HMAC-SHA256 en base64 de
 * `id.timestamp.cuerpo`, con la clave `whsec_…` decodificada de base64.
 * [NO VERIFICADO contra la documentación de Resend: resend.com no es accesible
 * desde el entorno de desarrollo; probar con un evento real antes de confiar.]
 */
const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now: Date;
}): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(input.now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  if (key.length < 16) return false;
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest("base64");
  return signature
    .split(" ")
    .map((part) => part.split(",", 2))
    .some(([version, value]) => version === "v1" && !!value && constantTimeEqual(value, expected));
}

export type EmailEvent = { kind: "bounce" | "complaint"; emails: string[]; eventId: string };

/** Solo rebotes y quejas suprimen; «delivery_delayed» u otros no hacen nada. */
export function parseEmailEvent(rawBody: string, eventId: string): EmailEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const event = json as { type?: unknown; data?: { to?: unknown } };
  const kind =
    event.type === "email.bounced"
      ? "bounce"
      : event.type === "email.complained"
        ? "complaint"
        : null;
  if (!kind) return null;
  const to = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to];
  const emails = to.filter((e): e is string => typeof e === "string" && e.length <= 254);
  return emails.length ? { kind, emails, eventId } : null;
}

export async function applyEmailEvent(db: Sql, event: EmailEvent): Promise<void> {
  for (const email of event.emails) {
    await db`select system.email_suppress(${email}, ${event.kind}, 'provider_webhook', ${event.eventId})`;
  }
}
