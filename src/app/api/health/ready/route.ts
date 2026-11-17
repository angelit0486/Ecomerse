import { readinessStatus } from "@/server/health/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness (GATE0 §35). La respuesta pública solo dice ok/degraded; la
 * comprobación (y su caché de 5 s por instancia) vive en server/health/readiness.
 */
export async function GET(request: Request): Promise<Response> {
  const status = await readinessStatus(request);
  return Response.json(
    { ok: status === "ok", data: { status } },
    { status: status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
