import { NextResponse, type NextRequest } from "next/server";

import { recordSecurityEvent } from "@/server/auth/security-events";
import { getSession } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Cierre de sesión (solo POST: un enlace o una imagen no pueden cerrar la sesión). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  if (session) await recordSecurityEvent("auth.logout", { userId: session.userId });
  return NextResponse.redirect(new URL("/ingresar", request.nextUrl), 303);
}
