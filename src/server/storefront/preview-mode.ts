import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { serverEnv } from "@/server/env";

import { STORE_ROUTE_HEADER, verifyStoreRoute } from "./route-signature";

/**
 * ¿Este request es la vista previa de ESTA tienda? (ADR-032). Solo lo dice la
 * firma del proxy, que ya validó la cookie de vista previa; nunca una cabecera o
 * un parámetro del cliente. Fuera de un request (sin cabeceras), nunca.
 */
export const isStorePreview = cache(async (storeId: string): Promise<boolean> => {
  let signature: string | null;
  try {
    signature = (await headers()).get(STORE_ROUTE_HEADER);
  } catch {
    return false;
  }
  return verifyStoreRoute(serverEnv().PREVIEW_HMAC_SECRET, storeId, signature)?.preview === true;
});
