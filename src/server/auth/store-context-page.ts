import "server-only";

import { notFound, redirect } from "next/navigation";

import { AppError } from "@/server/errors";

import type { StoreContext } from "./context";
import { getStoreContext } from "./store-context";

/**
 * Contexto de tienda para páginas del panel: traduce los errores a navegación
 * (sin sesión → /ingresar, sin 2FA → /seguridad/2fa, sin acceso → 404).
 */
export async function getStoreContextForPage(storeHandle: string): Promise<StoreContext> {
  try {
    return await getStoreContext(storeHandle);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "unauthenticated") redirect("/ingresar");
      if (error.code === "mfa_required") redirect("/seguridad/2fa");
      if (error.code === "not_found" || error.code === "forbidden") notFound();
    }
    throw error;
  }
}
