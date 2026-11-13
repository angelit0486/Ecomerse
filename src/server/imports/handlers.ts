import type { Sql } from "@/server/db/role-clients";

import { DeferJobError, type JobHandler } from "@/server/jobs/types";
import { payloadId } from "@/server/notifications/handlers";

/** Por debajo de esto no se empieza una confirmación: la toma la siguiente ejecución. */
export const MIN_IMPORT_BUDGET_MS = 25_000;
/** Margen para cerrar la transacción y responder antes del límite de la función. */
const SAFETY_MS = 3_000;

export const IMPORT_FAILED_MESSAGE =
  "La importación tardó demasiado o no se pudo aplicar. No se cambió nada: vuelve a intentarlo o divide el archivo.";

interface CommitResult {
  status: string;
  created?: number;
  updated?: number;
  row_number?: number | null;
  error?: string;
}

export interface ImportDeps {
  db: Sql;
  /** Tras una importación aplicada (invalidar la caché de la tienda). */
  onCommitted?: (storeId: string) => void;
  now?: () => number;
}

/**
 * Job `import.commit` (GATE0 §26.1 paso 4, CF-10). system.import_commit hace TODO
 * el lote en una transacción: revalida los permisos de quien confirmó y aplica con
 * las RPC del catálogo; sus errores de datos dejan la importación `failed` (sin
 * cambios). Aquí solo se ajusta el tiempo: la transacción no puede pasar del
 * límite de esta ejecución del runner.
 */
export function createImportHandlers(deps: ImportDeps): Array<[string, JobHandler]> {
  const now = deps.now ?? Date.now;
  const commit: JobHandler = async (job, { log, deadline }) => {
    const importJobId = payloadId(job, "import_job_id");
    const budget = deadline - now();
    if (budget < MIN_IMPORT_BUDGET_MS) throw new DeferJobError(`quedan ${budget} ms`);
    try {
      const result = await deps.db.begin(async (tx) => {
        await tx`select set_config('statement_timeout', ${String(budget - SAFETY_MS)}, true)`;
        // Las tablas crecen dentro de esta misma transacción: con estadísticas viejas
        // (tienda o plataforma nuevas) un plan en caché que recorra la tabla entera
        // en cada fila sería cuadrático. Solo índices, solo aquí. No se fuerza un
        // plan nuevo por sentencia: medido (Orden 06, CAP-03), replanificar las ~50
        // sentencias de cada fila costaba un tercio del tiempo (5 000 filas: 43 s →
        // 28 s) y con índices el crecimiento sigue siendo lineal.
        await tx`select set_config('enable_seqscan', 'off', true)`;
        const [row] = await tx<{ result: CommitResult }[]>`
          select system.import_commit(${importJobId}) as result
        `;
        // ADR-033: las fotos con enlace se reservan y encolan en la misma
        // transacción (si la importación falla, no queda ninguna a medias).
        if (row!.result.status === "completed") {
          await tx`select system.import_queue_remote_images(${importJobId})`;
          // Misión Portada/Marcas: descripción y logo (por enlace) de las marcas.
          await tx`select system.import_apply_brand_profiles(${importJobId})`;
        }
        // ADR-064: una parte de lote, aplicada o no, avanza el lote en esta misma
        // transacción (la siguiente parte empieza o el lote se detiene con el motivo).
        await tx`select system.import_batch_after_part(${importJobId})`;
        return row!.result;
      });
      log.info("Importación procesada", {
        import_job_id: importJobId,
        status: result.status,
        created: result.created,
        updated: result.updated,
        row_number: result.row_number,
      });
      if (result.status === "completed" && job.storeId) deps.onCommitted?.(job.storeId);
    } catch (error) {
      // Tiempo agotado o conexión perdida: la transacción se revirtió entera. Se
      // reintenta; en el último intento la importación queda fallida.
      if (job.attempts < job.maxAttempts) throw error;
      await deps.db.begin(async (tx) => {
        await tx`select system.import_commit_failed(${importJobId}, ${IMPORT_FAILED_MESSAGE})`;
        await tx`select system.import_batch_after_part(${importJobId})`;
      });
      log.warn("Importación fallida tras agotar los intentos", {
        import_job_id: importJobId,
        error,
      });
    }
  };
  return [["import.commit", commit]];
}
