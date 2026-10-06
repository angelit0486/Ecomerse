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
}

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
}: Pick<SecurityHeaderOptions, "nonce" | "isDev" | "storageOrigin">): string {
  const storage = originOf(storageOrigin);
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
    ["frame-ancestors", ["'none'"]],
    ...(isDev ? [] : ([["upgrade-insecure-requests", []]] as Array<[string, string[]]>)),
  ];
  return directives
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
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
