import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_ID_HEADER, generateRequestId } from "@/server/observability/request-id";
import { buildSecurityHeaders, generateNonce } from "@/server/security/headers";

/**
 * Proxy (Next.js 16; antes "middleware"). Fase 1:
 *  - asigna un request_id propio (no se confía en el del cliente);
 *  - genera el nonce de CSP y aplica las cabeceras de seguridad.
 * La resolución host → tienda se agrega en la Fase 2/5 (GATE0 §21.1).
 *
 * La autorización NUNCA depende del proxy: cada Server Action, Route Handler y la
 * base de datos verifican permisos por su cuenta (GATE0 §11.2).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const requestId = generateRequestId();
  const securityHeaders = buildSecurityHeaders({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    enableHsts: process.env.NODE_ENV === "production",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Next.js lee el nonce de la CSP del request para aplicarlo a sus scripts.
  requestHeaders.set("content-security-policy", securityHeaders["Content-Security-Policy"]!);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
