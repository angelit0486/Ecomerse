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
        // (tienda o plataforma nuevas) los planes en caché recorrerían tablas enteras
        // en cada fila (cuadrático). Índices y planes por ejecución, solo aquí.
        await tx`select set_config('enable_seqscan', 'off', true),
                        set_config('plan_cache_mode', 'force_custom_plan', true)`;
        const [row] = await tx<{ result: CommitResult }[]>`
          select system.import_commit(${importJobId}) as result
        `;
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
      await deps.db`select system.import_commit_failed(${importJobId}, ${IMPORT_FAILED_MESSAGE})`;
      log.warn("Importación fallida tras agotar los intentos", {
        import_job_id: importJobId,
        error,
      });
    }
  };
  return [["import.commit", commit]];
}
