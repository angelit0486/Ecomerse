import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";

export interface CatalogJobDeps {
  db: Sql;
  /** Tiendas con productos recién publicados o precios cambiados (invalidar su caché, §21.4). */
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
  /**
   * Job `catalog.apply_sales` (ADR-030): cada minuto empieza y termina las
   * ofertas con fechas. La base cambia el precio y lo regresa; aquí solo se
   * invalida la caché de las tiendas cuyo precio cambió.
   */
  const applySales: JobHandler = async (_job, { log, deadline }) => {
    // En lotes de 200 hasta vaciar lo pendiente (una oferta en bloque grande que
    // termina a la misma hora se regresa completa en la misma pasada).
    const rows: { store_id: string; result: string }[] = [];
    for (let i = 0; i < 20 && Date.now() < deadline; i += 1) {
      const batch = await deps.db<{ store_id: string; result: string }[]>`
        select store_id, result from system.apply_price_schedules(200)`;
      rows.push(...batch);
      if (batch.length < 200) break;
    }
    const changed = rows.filter((r) => r.result === "started" || r.result === "expired");
    for (const store of new Set(changed.map((r) => r.store_id))) deps.onPublished?.(store);
    if (rows.length > 0) {
      log.info("Ofertas con fechas", {
        started: rows.filter((r) => r.result === "started").length,
        ended: rows.length - rows.filter((r) => r.result === "started").length,
      });
    }
  };
  return [
    ["catalog.publish_scheduled", publishScheduled],
    ["catalog.apply_sales", applySales],
  ];
}
