import "server-only";

import { cache } from "react";

import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { parseStoreContext, type StoreContext } from "./context";
import { getSession } from "./session";

/**
 * Contexto de la tienda de la URL (`/admin/[storeHandle]`), validado en cada
 * request y memoizado solo dentro de él (§44.7). Sin sesión: unauthenticated;
 * sin 2FA: mfa_required; sin acceso: not_found (no revela si la tienda existe).
 */
export const getStoreContext = cache(async (storeHandle: string): Promise<StoreContext> => {
  const session = await getSession();
  if (!session) throw new AppError("unauthenticated");
  if (session.aal !== "aal2") throw new AppError("mfa_required");
  const supabase = await createSupabaseServerClient();
  const raw = await callRpc<unknown>(supabase, "access_store_context", { p_handle: storeHandle });
  return parseStoreContext(raw);
});
