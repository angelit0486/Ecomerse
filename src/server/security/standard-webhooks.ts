import { createHmac } from "node:crypto";

import { constantTimeEqual } from "./hmac";

/**
 * Verificación de Standard Webhooks (https://www.standardwebhooks.com), el formato
 * de los Auth Hooks de Supabase: HMAC-SHA256 en base64 de `${id}.${timestamp}.${body}`
 * con el secreto `v1,whsec_<base64>`, marca de tiempo dentro de ±5 minutos.
 */
const SECRET_RE = /^v1,whsec_([A-Za-z0-9+/=]{24,})$/;

export function isStandardWebhookSecret(secret: string): boolean {
  return SECRET_RE.test(secret);
}

export function signStandardWebhook(secret: string, id: string, timestamp: number, body: string) {
  const key = Buffer.from(SECRET_RE.exec(secret)![1]!, "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

export type StandardWebhookResult =
  { ok: true; id: string } | { ok: false; reason: "malformed" | "stale" | "bad_signature" };

export function verifyStandardWebhook(input: {
  secret: string;
  headers: Headers;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): StandardWebhookResult {
  const id = input.headers.get("webhook-id");
  const timestamp = input.headers.get("webhook-timestamp");
  const signatures = input.headers.get("webhook-signature");
  if (!SECRET_RE.test(input.secret)) return { ok: false, reason: "malformed" };
  if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !timestamp || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "malformed" };
  }
  if (!signatures || signatures.length > 2000) return { ok: false, reason: "malformed" };
  const ts = Number(timestamp);
  if (Math.abs(input.nowSeconds - ts) > (input.toleranceSeconds ?? 300)) {
    return { ok: false, reason: "stale" };
  }
  const expected = signStandardWebhook(input.secret, id, ts, input.body);
  // Varias firmas separadas por espacio (rotación de secretos): basta una válida.
  const valid = signatures
    .split(" ")
    .some((candidate) => candidate.startsWith("v1,") && constantTimeEqual(candidate, expected));
  return valid ? { ok: true, id } : { ok: false, reason: "bad_signature" };
}
