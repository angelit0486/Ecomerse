import type { Sql } from "@/server/db/role-clients";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { UUID_RE } from "@/server/notifications/handlers";

import {
  DomainTakenError,
  verificationRecordName,
  type DomainProvider,
  type ProviderState,
  type TxtLookup,
} from "./provider";

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

    // Un fallo de DNS o del proveedor no corta la cadena: se registra como «aún
    // no» y la base programa la siguiente revisión (revisión del estudio, R-3).
    const txt = await deps.txt(verificationRecordName(target.hostname)).catch((error: unknown) => {
      log.warn("DNS sin respuesta", { err: error });
      return [] as string[];
    });
    const [match] = await deps.db<{ owned: boolean }[]>`
      select system.domains_txt_matches(${id}, ${txt}) as owned
    `;
    let ref = target.provider_ref;
    let state: ProviderState = "pending";
    try {
      // Al proveedor solo después de probar la propiedad con el TXT (R-4).
      if (!ref && match?.owned) ref = (await deps.provider.add(target.hostname)).ref;
      if (ref) state = await deps.provider.state(target.hostname);
    } catch (error) {
      log.warn("Proveedor de dominios sin respuesta", { err: error });
      state = "pending";
    }
    const [result] = await deps.db<{ result: { status: string; owned: boolean } }[]>`
      select system.domains_record_check(${id}, ${txt}, ${state}, ${ref}) as result
    `;
    log.info("Dominio revisado", {
      status: result!.result.status,
      owned: result!.result.owned,
      provider: state,
    });
  };

  /**
   * Job `domains.attach_platform`: da de alta en el hosting la dirección de la
   * plataforma de una tienda nueva (p. ej. `pruva-tienda-<dirección>.vercel.app`)
   * y lo anota. Sin proveedor configurado no hace nada (se da de alta a mano).
   */
  const attachPlatform: JobHandler = async (job, { log }) => {
    const id = job.payload.domain_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw new PermanentJobError("payload.domain_id inválido");
    }
    const [row] = await deps.db<{ target: { store_id: string; hostname: string } | null }[]>`
      select system.domains_platform_target(${id}) as target
    `;
    const target = row?.target;
    if (!target) return; // ya dada de alta, quitada o no es de la plataforma

    let ref: string | null;
    try {
      ref = (await deps.provider.add(target.hostname)).ref;
    } catch (error) {
      if (error instanceof DomainTakenError) throw new PermanentJobError(error.message);
      throw error; // red o API: el job reintenta
    }
    if (!ref) {
      log.warn("Sin proveedor de dominios: la dirección se da de alta a mano", {
        hostname: target.hostname,
      });
      return;
    }
    await deps.db`select system.domains_platform_attached(${id}, ${ref})`;
    log.info("Dirección de la tienda dada de alta en el hosting", { hostname: target.hostname });
  };

  return [
    ["domains.verify", verify],
    ["domains.attach_platform", attachPlatform],
  ];
}
