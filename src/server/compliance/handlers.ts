import type { Sql } from "@/server/db/role-clients";

import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";
import { UUID_RE } from "@/server/notifications/handlers";

interface RecheckResult {
  checked: number;
  unpublished: number;
  stores: string[];
  done: boolean;
}

export interface ComplianceDeps {
  db: Sql;
  /** Tiendas con productos despublicados (invalidar su caché). */
  onUnpublished?: (storeId: string) => void;
}

function optionalId(job: JobRecord, key: string): string | null {
  const value = job.payload[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new PermanentJobError(`payload.${key} inválido`);
  }
  return value;
}

/**
 * Job `compliance.recheck` (ADR-021): tras un cambio de reglas de la plataforma o
 * al declarar una categoría regulada, despublica los productos activos que dejaron
 * de cumplir (denegación por defecto). Cada job revisa un lote; la función encola
 * la continuación si quedan productos.
 */
export function createComplianceHandlers(deps: ComplianceDeps): Array<[string, JobHandler]> {
  const recheck: JobHandler = async (job, { log }) => {
    const profileId = optionalId(job, "profile_id");
    const storeId = optionalId(job, "store_id");
    const after = optionalId(job, "after");
    if ((profileId === null) === (storeId === null)) {
      throw new PermanentJobError("compliance.recheck necesita un perfil o una tienda");
    }
    const [row] = await deps.db<{ result: RecheckResult }[]>`
      select system.compliance_recheck(${profileId}, ${storeId}, ${after}, 200) as result
    `;
    const result = row!.result;
    for (const store of result.stores) deps.onUnpublished?.(store);
    log.info("Cumplimiento revisado", {
      checked: result.checked,
      unpublished: result.unpublished,
      done: result.done,
    });
  };
  return [["compliance.recheck", recheck]];
}
