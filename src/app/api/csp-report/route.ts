import { log } from "@/server/observability/logger";
import { CSP_REPORT_MAX_BYTES, logBudget, parseCspReports } from "@/server/security/csp-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allow = logBudget();

/**
 * Reportes de CSP del navegador (auditoría global, paso 23). Sin base de datos:
 * se registran resumidos y sin consulta ni fragmento de las URL, con un tope por
 * minuto. Siempre 204 para lo que se pudo leer: no hay nada que responder.
 */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > CSP_REPORT_MAX_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > CSP_REPORT_MAX_BYTES) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const violation of parseCspReports(body)) {
    if (!allow(Date.now())) break;
    log.warn("Violación de CSP", { ...violation });
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
