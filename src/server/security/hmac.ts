import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma HMAC-SHA256 de `${timestamp}.${body}` en hexadecimal.
 * Se usa para disparos firmados del runner de jobs y, después, para tokens de
 * vista previa (GATE0 §28.4, CF-09).
 */
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
}

/**
 * Comparación en tiempo constante, también para longitudes distintas: se comparan
 * los SHA-256 de ambos valores para no filtrar la longitud del secreto.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export interface VerifySignedPayloadInput {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}

/** Verifica firma y marca de tiempo (protección contra replay, GATE0 T-10). */
export function verifySignedPayload(input: VerifySignedPayloadInput): boolean {
  const { secret, timestamp, signature, body, nowSeconds } = input;
  const tolerance = input.toleranceSeconds ?? 60;
  if (!timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const ts = Number(timestamp);
  if (Math.abs(nowSeconds - ts) > tolerance) return false;
  return constantTimeEqual(signPayload(secret, ts, body), signature);
}
