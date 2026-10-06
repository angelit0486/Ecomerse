import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/server/env";
import { createLogger } from "@/server/observability/logger";
import { REQUEST_ID_HEADER, generateRequestId } from "@/server/observability/request-id";
import { classifyHost, isInternalStorePath, normalizeHost } from "@/server/routing/host";
import { decideStorefront } from "@/server/routing/storefront-decision";
import { buildSecurityHeaders, generateNonce } from "@/server/security/headers";
import {
  PREVIEW_COOKIE,
  PREVIEW_TTL_SECONDS,
  verifyPreviewToken,
} from "@/server/storefront/preview";
import { resolveHost } from "@/server/storefront/resolve-host";
import { signStoreRoute, STORE_ROUTE_HEADER } from "@/server/storefront/route-signature";
import { refreshSupabaseSession } from "@/server/supabase/proxy-session";

/**
 * Proxy (Next.js 16; antes "middleware"):
 *  - request_id propio (no se confía en el del cliente), nonce de CSP y
 *    cabeceras de seguridad;
 *  - host del panel: renueva la sesión de Supabase;
 *  - host de tienda: resolución host → tienda (GATE0 §21.1) y reescritura
 *    interna a /_store/{store_id}. El store_id SOLO sale de store_domains.
 *
 * La autorización NUNCA depende del proxy: cada Server Action, Route Handler y la
 * base de datos verifican permisos por su cuenta (GATE0 §11.2).
 */

/** Cabeceras internas que nunca se aceptan del cliente. */
const INTERNAL_HEADERS = [
  "x-store-id",
  "x-store-preview",
  STORE_ROUTE_HEADER,
  "x-pathname",
  "x-nonce",
  REQUEST_ID_HEADER,
];

const log = createLogger();

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();
  const nonce = generateNonce();
  const requestId = generateRequestId();
  const securityHeaders = buildSecurityHeaders({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    storageOrigin: env.NEXT_PUBLIC_SUPABASE_URL,
    enableHsts: process.env.NODE_ENV === "production",
  });

  const requestHeaders = new Headers(request.headers);
  for (const name of INTERNAL_HEADERS) requestHeaders.delete(name);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Next.js lee el nonce de la CSP del request para aplicarlo a sus scripts.
  requestHeaders.set("content-security-policy", securityHeaders["Content-Security-Policy"]!);

  const finish = (response: NextResponse): NextResponse => {
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  const { pathname, search } = request.nextUrl;
  if (isInternalStorePath(pathname)) return finish(notFound());

  const host = normalizeHost(request.headers.get("host"));
  const kind = classifyHost(host, normalizeHost(env.APP_HOSTNAME) ?? "");
  const secure = env.APP_ENV !== "development" && env.APP_ENV !== "test";

  if (kind === "panel") {
    // Ruta del request para auditar las páginas vistas por soporte (§7.7).
    requestHeaders.set("x-pathname", pathname);
    if (pathname.startsWith("/api/")) {
      return finish(NextResponse.next({ request: { headers: requestHeaders } }));
    }
    return finish(
      await refreshSupabaseSession({
        request,
        requestHeaders,
        url: env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        secureCookies: secure,
      }),
    );
  }
  if (kind === "invalid" || !host) return finish(notFound());

  let resolution;
  try {
    resolution = await resolveHost(host);
  } catch (error) {
    log.error("storefront.resolve_host_failed", { request_id: requestId, err: error });
    return finish(unavailable());
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const preview = verifyPreviewToken(
    env.PREVIEW_HMAC_SECRET,
    request.cookies.get(PREVIEW_COOKIE)?.value,
    nowSeconds,
  );
  const decision = decideStorefront({
    host,
    pathname,
    search,
    protocol: request.nextUrl.protocol === "https:" ? "https" : "http",
    resolution,
    previewStoreId: preview?.storeId ?? null,
  });

  switch (decision.type) {
    case "not_found":
      return finish(notFound());
    case "unavailable":
      return finish(unavailable());
    case "redirect":
      return finish(NextResponse.redirect(decision.location, 301));
    case "rewrite": {
      if (pathname === "/_preview" && resolution) {
        // Canje del token del panel por la cookie host-only de esta tienda.
        const token = verifyPreviewToken(
          env.PREVIEW_HMAC_SECRET,
          request.nextUrl.searchParams.get("token"),
          nowSeconds,
        );
        if (!token || token.storeId !== resolution.storeId) return finish(notFound());
        const response = NextResponse.redirect(new URL("/", request.nextUrl), 303);
        response.cookies.set(PREVIEW_COOKIE, request.nextUrl.searchParams.get("token")!, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          maxAge: Math.min(PREVIEW_TTL_SECONDS, token.exp - nowSeconds),
        });
        response.headers.set("cache-control", "no-store");
        return finish(response);
      }
      if (decision.preview) requestHeaders.set("x-store-preview", "1");
      requestHeaders.set(
        STORE_ROUTE_HEADER,
        signStoreRoute(env.PREVIEW_HMAC_SECRET, resolution!.storeId, decision.preview),
      );
      // clone() conserva el origen interno del servidor: la reescritura queda
      // interna. Una URL con otro origen haría que Next la tratara como proxy externo
      // (en local, arrancar con `-H localhost`: Next normaliza 127.0.0.1 a localhost).
      const target = request.nextUrl.clone();
      target.pathname = decision.pathname;
      const response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
      if (decision.preview) {
        response.headers.set("x-robots-tag", "noindex, nofollow");
        response.headers.set("cache-control", "no-store");
      }
      return finish(response);
    }
  }
}

function page(status: number, title: string, message: string): NextResponse {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 404 idéntico para tienda inexistente, cerrada o en borrador sin vista previa. */
function notFound(): NextResponse {
  return page(404, "Tienda no disponible", "No encontramos esta tienda.");
}

function unavailable(): NextResponse {
  const response = page(
    503,
    "Tienda en mantenimiento",
    "Esta tienda no está disponible en este momento. Vuelve a intentarlo más tarde.",
  );
  response.headers.set("retry-after", "300");
  return response;
}

export const config = {
  // Sin excepciones por cabecera: un `missing` de prefetch permitía saltarse el
  // proxy (y con él el bloqueo de /_store y la resolución de host).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
