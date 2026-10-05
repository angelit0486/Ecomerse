import { constantTimeEqual } from "@/server/security/hmac";
import { createHmac } from "node:crypto";

/**
 * Firma de la reescritura interna del proxy → /_store/{storeId} (defensa en
 * profundidad de GATE0 §21.1, paso 9): la página solo se renderiza si el proxy
 * resolvió esa tienda en este request. Incluye el modo vista previa para que un
 * cliente no pueda activarlo con una cabecera.
 */
export const STORE_ROUTE_HEADER = "x-store-route";

export function signStoreRoute(secret: string, storeId: string, preview: boolean): string {
  return createHmac("sha256", secret)
    .update(`store-route:${storeId}:${preview ? "preview" : "public"}`)
    .digest("hex");
}

/** Devuelve el modo verificado o null si la firma no corresponde a esta tienda. */
export function verifyStoreRoute(
  secret: string,
  storeId: string,
  signature: string | null,
): { preview: boolean } | null {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (constantTimeEqual(signStoreRoute(secret, storeId, false), signature))
    return { preview: false };
  if (constantTimeEqual(signStoreRoute(secret, storeId, true), signature)) return { preview: true };
  return null;
}
