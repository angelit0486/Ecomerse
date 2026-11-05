/**
 * Reportes de CSP (auditoría global, paso 23). El navegador avisa cuando la CSP
 * bloquea algo; aquí se reducen a lo útil para diagnosticar sin guardar datos
 * personales: directiva, y de cada URL solo origen y ruta (el enlace del pedido
 * lleva su token en `?t=`, así que la consulta y el fragmento nunca se guardan).
 */
export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_MAX_BYTES = 16_384;
/** Reportes que se leen de una sola petición (el resto se ignora). */
const MAX_REPORTS = 20;

export interface CspViolation {
  directive: string;
  blocked: string;
  document: string;
  source: string;
  line: number | null;
  disposition: "enforce" | "report";
}

const KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "self",
  "data",
  "blob",
  "trusted-types-policy",
  "trusted-types-sink",
]);

/** Origen y ruta de una URL; una palabra clave de CSP tal cual; si no, «otro». */
export function redactUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  if (KEYWORDS.has(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol.slice(0, -1);
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return "otro";
  }
}

function text(value: unknown, max = 100): string {
  return typeof value === "string" ? value.replace(/[^\x20-\x7e]/g, "").slice(0, max) : "";
}

function violation(r: Record<string, unknown>, camel: boolean): CspViolation | null {
  const get = (camelKey: string, dashed: string) => (camel ? r[camelKey] : r[dashed]);
  const directive =
    text(get("effectiveDirective", "effective-directive")) ||
    text(get("violatedDirective", "violated-directive"));
  if (!directive) return null;
  const line = Number(get("lineNumber", "line-number"));
  return {
    directive,
    blocked: redactUrl(get("blockedURL", "blocked-uri")),
    document: redactUrl(get("documentURL", "document-uri")),
    source: redactUrl(get("sourceFile", "source-file")),
    line: Number.isInteger(line) && line >= 0 ? line : null,
    disposition: get("disposition", "disposition") === "report" ? "report" : "enforce",
  };
}

/**
 * Acepta los dos formatos: `report-uri` (`{"csp-report": {...}}`, claves con
 * guiones) y la Reporting API de `report-to` (`[{type: "csp-violation", body}]`).
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(body)) {
    for (const item of body.slice(0, MAX_REPORTS)) {
      if (!item || typeof item !== "object") continue;
      const { type, body: inner } = item as { type?: unknown; body?: unknown };
      if (type !== "csp-violation" || !inner || typeof inner !== "object") continue;
      const v = violation(inner as Record<string, unknown>, true);
      if (v) out.push(v);
    }
  } else if (body && typeof body === "object" && "csp-report" in body) {
    const inner = (body as Record<string, unknown>)["csp-report"];
    if (inner && typeof inner === "object") {
      const v = violation(inner as Record<string, unknown>, false);
      if (v) out.push(v);
    }
  }
  return out;
}

/** Como mucho `max` registros por ventana y por instancia: un sitio hostil no llena los logs. */
export function logBudget(max = 30, windowMs = 60_000) {
  let start = Number.NEGATIVE_INFINITY;
  let used = 0;
  return (now: number): boolean => {
    if (now - start >= windowMs) {
      start = now;
      used = 0;
    }
    if (used >= max) return false;
    used += 1;
    return true;
  };
}
