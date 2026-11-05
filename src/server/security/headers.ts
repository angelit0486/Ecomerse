/**
 * Cabeceras de seguridad (GATE0 §21 / T-06, Fase 1).
 *
 * CSP con nonce por request + 'strict-dynamic'. Next.js aplica el nonce a sus
 * scripts en páginas con renderizado dinámico (por eso el layout raíz es dinámico).
 * Decisión registrada D-F1-02: el storefront cacheado (Fase 5) evaluará CSP por
 * hashes (SRI experimental de Next) porque los nonces impiden el cacheo estático.
 */

export interface SecurityHeaderOptions {
  nonce: string;
  /** `next dev` necesita 'unsafe-eval' y websockets para HMR. */
  isDev: boolean;
  /** Strict-Transport-Security solo en builds de producción (HTTPS garantizado). */
  enableHsts: boolean;
  /**
   * Origen de Supabase (F3-T03): el panel sube imágenes con PUT directo a
   * Storage y las muestra desde su URL pública. Solo ese origen, nunca comodines.
   */
  storageOrigin?: string | undefined;
  /**
   * Origen del panel (APP_URL), a donde el navegador manda los reportes de CSP
   * (paso 23). Absoluto: en el host de una tienda, /api/* es de la tienda.
   */
  reportOrigin?: string | undefined;
}

import { CSP_REPORT_PATH } from "./csp-report";

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Origen (esquema + host + puerto) de una URL http(s); null si no es válida. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
  storageOrigin,
  reportOrigin,
}: Pick<SecurityHeaderOptions, "nonce" | "isDev" | "storageOrigin" | "reportOrigin">): string {
  const storage = originOf(storageOrigin);
  const report = reportEndpoint(reportOrigin);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    ],
    ["style-src", ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`]],
    ["img-src", ["'self'", "blob:", "data:", ...(storage ? [storage] : [])]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(storage ? [storage] : []), ...(isDev ? ["ws:", "wss:"] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    // Bloque de video (ADR-034): el reproductor se crea solo al tocarlo y solo
    // desde estos dos hosts fijos; la tienda nunca guarda una URL de video.
    ["frame-src", ["https://www.youtube-nocookie.com", "https://player.vimeo.com"]],
    ["frame-ancestors", ["'none'"]],
    ...(isDev ? [] : ([["upgrade-insecure-requests", []]] as Array<[string, string[]]>)),
    // report-uri para Firefox y Safari; report-to (Reporting-Endpoints) para Chromium.
    ...(report
      ? ([
          ["report-uri", [report]],
          ["report-to", ["csp"]],
        ] as Array<[string, string[]]>)
      : []),
  ];
  return directives
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

/** URL absoluta del receptor de reportes; null si el origen no es http(s) válido. */
export function reportEndpoint(origin: string | undefined): string | null {
  const base = originOf(origin);
  return base ? `${base}${CSP_REPORT_PATH}` : null;
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const report = reportEndpoint(options.reportOrigin);
  return {
    ...(report ? { "Reporting-Endpoints": `csp="${report}"` } : {}),
    "Content-Security-Policy": buildContentSecurityPolicy(options),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(options.enableHsts
      ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" }
      : {}),
  };
}
