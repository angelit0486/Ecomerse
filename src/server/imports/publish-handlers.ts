import type { Sql } from "@/server/db/role-clients";

import { DeferJobError, type JobHandler } from "@/server/jobs/types";
import { payloadId } from "@/server/notifications/handlers";

/** Candidatos por tanda: cada tanda es una transacción corta. */
export const PUBLISH_BATCH = 200;
/** Por debajo de esto no se empieza otra tanda: la toma la siguiente ejecución. */
export const MIN_PUBLISH_BUDGET_MS = 8_000;
/** Tope de cada tanda dentro de la base. */
const STEP_TIMEOUT_MS = 20_000;

interface StepResult {
  status: string;
  processed?: number;
  remaining: number;
}

export interface PublishDeps {
  db: Sql;
  /** Tras publicar algo (invalidar la caché de la tienda). */
  onPublished?: (storeId: string) => void;
  now?: () => number;
}

/**
 * Job `catalog.publish_run` (Orden 10, mensaje 4): publica por tandas los
 * candidatos de una importación con las reglas de publicación de siempre
 * (system.publish_run_step). Cada tanda es su propia transacción: si el worker
 * se cae, lo publicado se queda y la siguiente ejecución sigue con lo pendiente.
 * Sin tiempo para otra tanda, el job se aplaza (no cuenta como intento).
 */
export function createPublishHandlers(deps: PublishDeps): Array<[string, JobHandler]> {
  const now = deps.now ?? Date.now;
  const run: JobHandler = async (job, { log, deadline }) => {
    const runId = payloadId(job, "run_id");
    let processed = 0;
    for (;;) {
      if (deadline - now() < MIN_PUBLISH_BUDGET_MS) {
        if (processed > 0 && job.storeId) deps.onPublished?.(job.storeId);
        throw new DeferJobError(`publicación a medias: ${processed} revisados en esta ejecución`);
      }
      const result = await deps.db.begin(async (tx) => {
        await tx`select set_config('statement_timeout', ${String(STEP_TIMEOUT_MS)}, true)`;
        const [row] = await tx<{ r: StepResult }[]>`
          select system.publish_run_step(${runId}, ${PUBLISH_BATCH}) as r`;
        return row!.r;
      });
      processed += result.processed ?? 0;
      if (result.remaining === 0) {
        log.info("Publicación de candidatos terminada", {
          run_id: runId,
          status: result.status,
          processed,
        });
        if (processed > 0 && job.storeId) deps.onPublished?.(job.storeId);
        return;
      }
    }
  };
  return [["catalog.publish_run", run]];
}
