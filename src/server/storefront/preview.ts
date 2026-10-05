import { randomBytes } from "node:crypto";

import { constantTimeEqual, signPayload } from "@/server/security/hmac";

/**
 * Token de vista previa de una tienda en borrador (GATE0 CF-09): el panel lo
 * firma con HMAC (store_id, exp de 15 min, nonce) y el storefront lo canjea por
 * la cookie host-only `__preview` con la misma vigencia.
 *
 * Formato: `${storeId}.${exp}.${nonce}.${hmac}`; la firma cubre los tres primeros.
 */
export const PREVIEW_COOKIE = "__preview";
export const PREVIEW_TTL_SECONDS = 15 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createPreviewToken(secret: string, storeId: string, nowSeconds: number): string {
  if (!UUID_RE.test(storeId)) throw new Error("storeId inválido");
  const exp = nowSeconds + PREVIEW_TTL_SECONDS;
  const nonce = randomBytes(12).toString("hex");
  const body = `${storeId}.${nonce}`;
  return `${storeId}.${exp}.${nonce}.${signPayload(secret, exp, body)}`;
}

export interface VerifiedPreview {
  storeId: string;
  exp: number;
}

/** Devuelve la tienda y la caducidad si el token es auténtico y vigente. */
export function verifyPreviewToken(
  secret: string,
  token: string | null | undefined,
  nowSeconds: number,
): VerifiedPreview | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [storeId, expRaw, nonce, signature] = parts as [string, string, string, string];
  if (!UUID_RE.test(storeId) || !/^\d{1,12}$/.test(expRaw) || !/^[0-9a-f]{24}$/.test(nonce)) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  const exp = Number(expRaw);
  if (exp <= nowSeconds || exp > nowSeconds + PREVIEW_TTL_SECONDS) return null;
  if (!constantTimeEqual(signPayload(secret, exp, `${storeId}.${nonce}`), signature)) return null;
  return { storeId, exp };
}
