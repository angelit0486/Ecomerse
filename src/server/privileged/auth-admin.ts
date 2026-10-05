import "server-only";

import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/server/env";

/**
 * Supabase Auth Admin con service_role (lista blanca §11.5, uso #1). Solo
 * gestiona identidades de Auth; nunca consulta tablas. La autorización ocurre
 * ANTES, en la base, desde el servicio que lo invoca.
 */
function adminClient() {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Elimina todos los factores MFA del usuario. Devuelve cuántos eliminó. */
export async function deleteAllMfaFactors(userId: string): Promise<number> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  for (const factor of data.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) throw deleteError;
  }
  return data.factors.length;
}
