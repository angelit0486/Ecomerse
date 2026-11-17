import { workerDb } from "@/server/db/role-clients";
import { log } from "@/server/observability/logger";
import { requestIdFrom } from "@/server/observability/request-id";

const TIMEOUT_MS = 3_000;
/** Si el job listo más antiguo espera más de esto, la cola está atascada. */
const MAX_QUEUE_LAG_SECONDS = 300;

interface HealthCheck {
  db: boolean;
  oldest_ready_seconds: number;
  running_jobs: number;
  dead_jobs: number;
}

/** Cuánto se reutiliza el último resultado: el endpoint es público (auditoría 2026-11-17, hallazgo 4). */
export const READY_CACHE_MS = 5_000;

export type Status = "ok" | "degraded";

/**
 * Por instancia: el último resultado y la comprobación en curso. Llamadas
 * seguidas o simultáneas (monitores, o alguien martillando la URL) comparten
 * UNA consulta a la base cada 5 s en lugar de una por llamada. Solo se guarda
 * ok/degraded, que es lo único que se responde.
 */
let last: { status: Status; at: number } | null = null;
let pending: Promise<Status> | null = null;

async function check(requestId: string): Promise<Status> {
  let status: Status = "ok";
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
  return status;
}

/** Solo para pruebas: olvida el resultado guardado. */
export function resetReadinessCache(): void {
  last = null;
  pending = null;
}

/**
 * Readiness (GATE0 §35): base de datos alcanzable con el rol system_worker y cola
 * sin atascos; el detalle va al log.
 */
export async function readinessStatus(request: Request): Promise<Status> {
  if (last && Date.now() - last.at < READY_CACHE_MS) return last.status;
  pending ??= check(requestIdFrom(request.headers)).then((status) => {
    last = { status, at: Date.now() };
    pending = null;
    return status;
  });
  return pending;
}
