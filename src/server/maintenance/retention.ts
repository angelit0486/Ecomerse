import { z } from "zod";

import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";

/**
 * ADR-060: limpieza diaria de datos (`data.retention`, que encola
 * system.enqueue_maintenance). La base decide qué se borra y con qué plazo
 * (system.purge_retention): trabajos de la cola, filas crudas de importación,
 * correos de más de 12 meses y carritos abandonados sin pedido. Nunca pedidos,
 * pagos ni auditoría (regla 9). Aquí solo se repite por lotes mientras quede
 * trabajo, con tope de lotes y respetando el tiempo de la ejecución.
 */
export const MAX_RETENTION_BATCHES = 10;
/** Margen antes del fin de la ejecución para no empezar un lote que no cabe. */
const DEADLINE_MARGIN_MS = 5_000;

const resultSchema = z.object({
  jobs: z.number(),
  import_jobs: z.number(),
  import_rows: z.number(),
  notifications: z.number(),
  carts: z.number(),
  more: z.boolean(),
});
export type RetentionResult = z.infer<typeof resultSchema>;

export function createRetentionHandlers(deps: { db: Sql }): Array<[string, JobHandler]> {
  const run: JobHandler = async (_job, { log, deadline }) => {
    const total = { jobs: 0, import_jobs: 0, import_rows: 0, notifications: 0, carts: 0 };
    let batches = 0;
    let more = true;
    while (more && batches < MAX_RETENTION_BATCHES) {
      if (batches > 0 && Date.now() > deadline - DEADLINE_MARGIN_MS) break;
      const [row] = await deps.db<{ r: unknown }[]>`select system.purge_retention() as r`;
      const result = resultSchema.parse(row?.r);
      for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += result[key];
      more = result.more;
      batches += 1;
    }
    // Lo que quede lo toma la corrida de mañana (o la siguiente ejecución del día).
    log.info("Retención de datos aplicada", { ...total, batches, pending: more });
  };
  return [["data.retention", run]];
}
