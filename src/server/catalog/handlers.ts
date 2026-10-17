import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";

export interface CatalogJobDeps {
  db: Sql;
  /** Tiendas con productos recién publicados (invalidar su caché, §21.4). */
  onPublished?: (storeId: string) => void;
}

/**
 * Job `catalog.publish_scheduled` (tanda 7): cada minuto publica los borradores
 * con la hora programada vencida. La base valida igual que la publicación
 * manual; lo que no pasa pierde el horario y queda en la auditoría.
 */
export function createCatalogHandlers(deps: CatalogJobDeps): Array<[string, JobHandler]> {
  const publishScheduled: JobHandler = async (_job, { log }) => {
    const rows = await deps.db<{ store_id: string; published: boolean }[]>`
      select store_id, published from system.publish_scheduled_products(100)`;
    const stores = new Set(rows.filter((r) => r.published).map((r) => r.store_id));
    for (const store of stores) deps.onPublished?.(store);
    const published = rows.filter((r) => r.published).length;
    if (rows.length > 0) {
      log.info("Publicación programada", { published, failed: rows.length - published });
    }
  };
  return [["catalog.publish_scheduled", publishScheduled]];
}
