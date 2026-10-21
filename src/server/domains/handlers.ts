import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { UUID_RE } from "@/server/notifications/handlers";

import { verificationRecordName, type DomainProvider, type TxtLookup } from "./provider";

export interface DomainDeps {
  db: Sql;
  provider: DomainProvider;
  txt: TxtLookup;
}

interface Target {
  store_id: string;
  hostname: string;
  status: string;
  provider_ref: string | null;
}

/**
 * Job `domains.verify` (E16): consulta el TXT de propiedad y el estado en el
 * proveedor, y entrega lo visto a la base, que decide (compara el TXT con el
 * hash del token y programa la siguiente revisión). Idempotente.
 */
export function createDomainHandlers(deps: DomainDeps): Array<[string, JobHandler]> {
  const verify: JobHandler = async (job, { log }) => {
    const id = job.payload.domain_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw new PermanentJobError("payload.domain_id inválido");
    }
    const [row] = await deps.db<{ target: Target | null }[]>`
      select system.domains_check_target(${id}) as target
    `;
    const target = row?.target;
    if (!target) return; // quitado, activo o vencido: nada que revisar

    let ref = target.provider_ref;
    if (!ref) ref = (await deps.provider.add(target.hostname)).ref;
    const [txt, state] = await Promise.all([
      deps.txt(verificationRecordName(target.hostname)),
      deps.provider.state(target.hostname),
    ]);
    const [result] = await deps.db<{ result: { status: string; owned: boolean } }[]>`
      select system.domains_record_check(${id}, ${txt}, ${state}, ${ref}) as result
    `;
    log.info("Dominio revisado", {
      status: result!.result.status,
      owned: result!.result.owned,
      provider: state,
    });
  };
  return [["domains.verify", verify]];
}
