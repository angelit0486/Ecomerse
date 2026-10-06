import { createHash, createHmac } from "node:crypto";

import { constantTimeEqual } from "@/server/security/hmac";

/**
 * Enlaces firmados del pedido (GATE0 §16.5). El token del invitado se deriva de la
 * clave de idempotencia del checkout: una repetición (doble clic) recupera el mismo
 * enlace sin guardarlo en la base, que solo conoce su SHA-256.
 */
const IDEM_RE = /^[A-Za-z0-9_-]{16,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function guestToken(secret: string, idempotencyKey: string): string {
  if (!IDEM_RE.test(idempotencyKey)) throw new Error("clave de idempotencia inválida");
  return createHmac("sha256", secret).update(`order-guest:${idempotencyKey}`).digest("base64url");
}

export function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function isGuestTokenShape(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Ruta de regreso permitida tras el pago simulado: solo la página del pedido. */
export function isOrderReturnPath(path: string): boolean {
  return /^\/pedido\/[0-9a-f-]{36}\?t=[A-Za-z0-9_-]{43}$/.test(path);
}

/**
 * Firma de la página del pago simulado: cubre el pago y la ruta de regreso, así
 * nadie la abre sin el enlace ni la usa como redirección abierta.
 */
export function fakePaymentSignature(
  secret: string,
  paymentId: string,
  returnPath: string,
): string {
  if (!UUID_RE.test(paymentId)) throw new Error("paymentId inválido");
  if (!isOrderReturnPath(returnPath)) throw new Error("ruta de regreso inválida");
  return createHmac("sha256", secret)
    .update(`fake-payment:${paymentId}:${returnPath}`)
    .digest("hex");
}

export function verifyFakePaymentSignature(
  secret: string,
  paymentId: string,
  returnPath: string | null | undefined,
  signature: string | null | undefined,
): boolean {
  if (!UUID_RE.test(paymentId) || !returnPath || !isOrderReturnPath(returnPath)) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return constantTimeEqual(fakePaymentSignature(secret, paymentId, returnPath), signature);
}
