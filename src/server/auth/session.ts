import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/server/supabase/server";

export type AuthLevel = "aal1" | "aal2";

export interface Session {
  userId: string;
  email: string | null;
  aal: AuthLevel;
}

/**
 * Sesión verificada del request (memoizada solo dentro del request con `cache`).
 * `getClaims()` valida la firma del JWT (con claves asimétricas, localmente; con
 * secreto simétrico, consultando a Supabase Auth). Nunca se confía en
 * `getSession()`, que solo lee la cookie.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  const { claims } = data;
  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
  };
});
