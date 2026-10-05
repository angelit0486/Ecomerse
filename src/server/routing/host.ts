/**
 * Normalización del host del request (GATE0 §21.1, paso 1): minúsculas, sin
 * puerto y sin punto final. Solo se usa el header Host; x-forwarded-host nunca.
 */
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  host = host.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253 || !HOSTNAME_RE.test(host)) return null;
  return host;
}

export type HostKind = "panel" | "storefront" | "invalid";

/** `panelHost` es el host del panel (APP_HOSTNAME), sin puerto. */
export function classifyHost(host: string | null, panelHost: string): HostKind {
  if (!host) return "invalid";
  return host === panelHost ? "panel" : "storefront";
}

/** Rutas internas del storefront: nunca accesibles desde fuera (§21.1, paso 9). */
export function isInternalStorePath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === "/_store" || lower.startsWith("/_store/") || lower.startsWith("/%5fstore");
}
