import { createHash, createHmac } from "node:crypto";

import { constantTimeEqual } from "@/server/security/hmac";

/**
 * Enlaces del recordatorio de carrito (ADR-048). La baja lleva el hash del correo
 * (nunca el correo) firmado con HMAC: nadie puede dar de baja a otra persona ni
 * leer su correo en la URL. El hash es el mismo que calcula `app.email_hash`.
 */
const HASH_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

export function emailHashHex(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

export function optoutSignature(secret: string, storeId: string, emailHash: string): string {
  if (!HASH_RE.test(emailHash)) throw new Error("hash de correo inválido");
  return createHmac("sha256", secret)
    .update(`cart-optout:${storeId}:${emailHash}`)
    .digest("base64url");
}

export function verifyOptout(
  secret: string,
  storeId: string,
  emailHash: string | null | undefined,
  signature: string | null | undefined,
): emailHash is string {
  if (!emailHash || !HASH_RE.test(emailHash) || !signature || !SIG_RE.test(signature)) {
    return false;
  }
  return constantTimeEqual(optoutSignature(secret, storeId, emailHash), signature);
}

/** Ruta de la baja dentro de la tienda (`/carrito/recordatorios?h=…&s=…`). */
export function optoutPath(secret: string, storeId: string, email: string): string {
  const h = emailHashHex(email);
  return `/carrito/recordatorios?h=${h}&s=${optoutSignature(secret, storeId, h)}`;
}

/** Ruta del enlace de un solo uso que recupera el carrito. */
export function recoverPath(token: string): string {
  return `/carrito/recuperar?t=${encodeURIComponent(token)}`;
}
