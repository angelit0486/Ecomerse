import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renueva la sesión de Supabase en el proxy (patrón oficial de @supabase/ssr):
 * los Server Components no pueden escribir cookies, así que el refresh rotativo
 * ocurre aquí. No autoriza nada: solo mantiene las cookies. En el panel la
 * respuesta sigue al destino; en una tienda (sesión de comprador, host-only)
 * se reescribe a la ruta interna.
 */
export async function refreshSupabaseSession(input: {
  request: NextRequest;
  requestHeaders: Headers;
  url: string;
  anonKey: string;
  secureCookies: boolean;
  rewriteTo?: URL;
}): Promise<NextResponse> {
  const { request, requestHeaders } = input;
  const make = () =>
    input.rewriteTo
      ? NextResponse.rewrite(input.rewriteTo, { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } });
  let response = make();

  // Sin cookies de sesión no hay nada que renovar (evita una llamada a Auth).
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;

  const supabase = createServerClient(input.url, input.anonKey, {
    cookieOptions: { httpOnly: true, secure: input.secureCookies, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.cookies.toString());
        response = make();
        for (const { name, value, options } of items) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}
