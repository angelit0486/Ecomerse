/**
 * Redacción de datos sensibles para logs, errores y auditoría (GATE0 §35, regla §44.15).
 * Se aplica por nombre de clave (recursivo) y por patrón dentro de los textos.
 */

const SENSITIVE_KEY =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|signature|session|email|phone|address|card|cvv)/i;

const REDACTED = "[redactado]";
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

const STRING_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Credenciales embebidas en URLs (postgres://usuario:clave@host).
  [/([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+@/gi, "$1[redactado]@"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redactado]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function redactString(value: string): string {
  let out = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  for (const [pattern, replacement] of STRING_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (depth >= MAX_DEPTH) return "[profundidad]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (value instanceof Error) {
      const code = (value as Error & { code?: unknown }).code;
      return {
        name: value.name,
        message: redactString(value.message),
        ...(typeof code === "string" ? { code } : {}),
        ...(value.stack ? { stack: redactString(value.stack) } : {}),
      };
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactInner(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS}]`);
      return items;
    }

    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactInner(inner, depth + 1, seen);
    }
    return out;
  }
  return undefined;
}
