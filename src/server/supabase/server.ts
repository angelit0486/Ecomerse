import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { serverEnv } from "@/server/env";

/**
 * Cliente de Supabase del usuario para el request actual (GATE0 §7.2: cookies
 * host-only, HttpOnly, Secure, SameSite=Lax). Las consultas pasan por RLS con el
 * JWT del usuario: nunca se usa service_role aquí.
 *
 * Se crea uno por request (no se comparte entre requests, §44.7).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: {
      httpOnly: true,
      secure: env.APP_ENV !== "development" && env.APP_ENV !== "test",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) cookieStore.set(name, value, options);
        } catch {
          // Server Components no pueden escribir cookies; el proxy renueva la sesión.
        }
      },
    },
  });
}
