import { log } from "@/server/observability/logger";
import { CSP_REPORT_MAX_BYTES, logBudget, parseCspReports } from "@/server/security/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allow = logBudget();

/**
 * Los reportes llegan también desde el host de cada tienda (otro origen): la
 * Reporting API de Chromium manda antes una verificación de CORS. Sin
 * credenciales y sin datos que devolver, se acepta cualquier origen.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** Lee el cuerpo hasta `max` bytes; null si se pasa (deja de leer en ese momento). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Reportes de CSP del navegador (auditoría global, paso 23). Sin base de datos:
 * se registran resumidos y sin consulta ni fragmento de las URL, con un tope por
 * minuto. Siempre 204 para lo que se pudo leer: no hay nada que responder.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await readCapped(request, CSP_REPORT_MAX_BYTES);
  if (raw === null) return new Response(null, { status: 413, headers: CORS });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers: CORS });
  }
  for (const violation of parseCspReports(body)) {
    if (!allow(Date.now())) break;
    log.warn("Violación de CSP", { ...violation });
  }
  return new Response(null, { status: 204, headers: { ...CORS, "cache-control": "no-store" } });
}
