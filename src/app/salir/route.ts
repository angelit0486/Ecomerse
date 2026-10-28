import { NextResponse, type NextRequest } from "next/server";

import { recordSecurityEvent } from "@/server/auth/security-events";
import { getSession } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Cierre de sesión (solo POST: un enlace o una imagen no pueden cerrar la sesión). */
export async function POST(request: NextRequest) {
  // Otro sitio no puede cerrar la sesión con un formulario (CSRF; revisión F1.9).
  if (request.headers.get("origin") !== new URL(serverEnv().APP_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }
  const session = await getSession();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  if (session) await recordSecurityEvent("auth.logout", { userId: session.userId });
  return NextResponse.redirect(new URL("/ingresar", request.nextUrl), 303);
}
