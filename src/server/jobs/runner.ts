import type { Logger } from "@/server/observability/logger";
import { redactString } from "@/server/observability/redact";

import { PermanentJobError, type JobRegistry, type JobStore } from "./types";

export interface RunJobsOptions {
  store: JobStore;
  registry: JobRegistry;
  workerId: string;
  log: Logger;
  /** Jobs por reclamo. */
  batchSize?: number;
  /** Tiempo máximo de la invocación (las funciones serverless tienen límite). */
  deadlineMs?: number;
  now?: () => number;
}

export interface RunJobsResult {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
}

const MAX_ERROR_LENGTH = 500;

/**
 * Procesa jobs hasta vaciar la cola lista o agotar el tiempo.
 * Un fallo nunca detiene el lote: se registra en el job (redactado) y se sigue.
 */
export async function runJobs(options: RunJobsOptions): Promise<RunJobsResult> {
  const { store, registry, workerId, log } = options;
  const batchSize = options.batchSize ?? 10;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? 50_000);
  const result: RunJobsResult = { claimed: 0, succeeded: 0, retried: 0, dead: 0 };

  while (now() < deadline) {
    const jobs = await store.claim(workerId, batchSize);
    if (jobs.length === 0) break;
    result.claimed += jobs.length;

    for (const job of jobs) {
      const jobLog = log.child({ job_id: job.id, job_type: job.type, store_id: job.storeId });
      const handler = registry.get(job.type);

      if (!handler) {
        await store.fail(job.id, workerId, "unknown_job_type", true);
        result.dead += 1;
        jobLog.error("Tipo de job desconocido");
        continue;
      }

      try {
        await handler(job, { log: jobLog });
        await store.complete(job.id, workerId);
        result.succeeded += 1;
      } catch (error) {
        const permanent = error instanceof PermanentJobError;
        const message = redactString(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        ).slice(0, MAX_ERROR_LENGTH);
        const status = await store.fail(job.id, workerId, message, permanent);
        if (status === "dead") result.dead += 1;
        else result.retried += 1;
        jobLog.warn("Job fallido", { attempt: job.attempts, status, error });
      }
    }
  }

  return result;
}
