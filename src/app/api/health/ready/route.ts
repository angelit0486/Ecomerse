import { workerDb } from "@/server/db/role-clients";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;
/** Si el job listo más antiguo espera más de esto, la cola está atascada. */
const MAX_QUEUE_LAG_SECONDS = 300;

interface HealthCheck {
  db: boolean;
  oldest_ready_seconds: number;
  running_jobs: number;
  dead_jobs: number;
}

/**
 * Readiness (GATE0 §35): base de datos alcanzable con el rol system_worker y cola
 * sin atascos. La respuesta pública solo dice ok/degraded; el detalle va al log.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = requestIdFrom(request.headers);
  let status: "ok" | "degraded" = "ok";
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const query = workerDb()<{ health: HealthCheck }[]>`select system.health_check() as health`;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("health_check timeout")), TIMEOUT_MS);
    });
    const [row] = await Promise.race([query, timeout]);
    const health = row?.health;
    if (!health?.db || health.oldest_ready_seconds > MAX_QUEUE_LAG_SECONDS) status = "degraded";
    log.info("Health readiness", { request_id: requestId, status, ...health });
  } catch (error) {
    status = "degraded";
    log.error("Health readiness falló", { request_id: requestId, error });
  } finally {
    clearTimeout(timer);
  }

  return Response.json(
    { ok: status === "ok", data: { status } },
    { status: status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
