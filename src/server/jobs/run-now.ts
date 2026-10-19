import "server-only";

import { after } from "next/server";

import { workerDb } from "@/server/db/role-clients";
import { log as rootLog, type Logger } from "@/server/observability/logger";

import { jobRegistry } from "./registry";
import { runJobs, type RunJobsResult } from "./runner";
import { createPostgresJobStore } from "./store";

/**
 * Una pasada del runner (GATE0 §28.4) con los límites de /api/jobs/run
 * (maxDuration = 60). La usan el cron y el arranque inmediato tras una acción.
 */
export async function runQueuedJobs(log: Logger): Promise<RunJobsResult> {
  const workerId = `${process.env.VERCEL_REGION ?? "local"}:${crypto.randomUUID()}`;
  return runJobs({
    store: createPostgresJobStore(workerDb()),
    registry: jobRegistry,
    workerId,
    log: log.child({ worker_id: workerId }),
    deadlineMs: 45_000,
    // Los handlers largos (importación) se ajustan a este límite.
    hardDeadlineMs: 55_000,
    // Un job por reclamo: el plazo se comprueba antes de cada uno y un medio
    // pesado (≤ 15 s con el timeout de sharp) no arrastra a otros (Gate F3).
    batchSize: 1,
  });
}

/**
 * Procesa la cola en cuanto termina la respuesta de una acción que acaba de
 * encolar trabajo (imagen subida, importación). Sin esto, en un plan con cron
 * diario la imagen o la importación esperan hasta la siguiente pasada. El
 * reclamo de jobs es atómico, así que varias pasadas a la vez no duplican nada.
 */
export function processQueueSoon(reason: string): void {
  after(async () => {
    const log = rootLog.child({ route: "jobs.run_now", reason });
    try {
      const result = await runQueuedJobs(log);
      log.info("Cola procesada tras la acción", { ...result });
    } catch (error) {
      // El cron sigue como respaldo: el trabajo queda en la cola.
      log.warn("No se pudo procesar la cola tras la acción", { error });
    }
  });
}
