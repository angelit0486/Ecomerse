import "server-only";

import postgres, { type Sql } from "postgres";

import { serverEnv } from "@/server/env";
import { createLogger } from "@/server/observability/logger";

import { withQueryDeadline } from "./query-deadline";

/**
 * Clientes de base de datos de mínimo privilegio (GATE0 §11.4, ADR-016).
 *
 * - workerDb: rol `system_worker`. Solo puede ejecutar funciones `system.*`
 *   (cola de jobs, health). No tiene acceso a ninguna tabla.
 * - gatewayDb: rol `storefront_gateway`. Solo puede ejecutar funciones
 *   `storefront.*` (resolución de host, datos públicos de la tienda).
 *
 * Conexión vía Supavisor en modo transacción: `prepare: false` es obligatorio y no
 * se usa estado de sesión (SET); todo pasa por llamadas a funciones. La única
 * marca es la de la vista previa (ADR-032): `set_config(…, true)` dentro de una
 * transacción, que se descarta al terminarla.
 *
 * El gateway (la tienda pública y el checkout) lleva un plazo por consulta
 * (F-08, `query-deadline.ts`): si Supavisor pierde una respuesta, el comprador ve
 * un error a los 15 s en vez de esperar a que Vercel corte la función, y el pool
 * atorado se reemplaza para que el siguiente intento funcione.
 */

/**
 * Plazo de cada consulta del gateway. La base corta su lado a los 5 s
 * (`statement_timeout` de `storefront_gateway`) y la conexión tiene 10 s para
 * abrirse (`connect_timeout`): 15 s cubre los dos; una respuesta que no llegó
 * para entonces ya no va a llegar.
 */
export const GATEWAY_QUERY_DEADLINE_MS = 15_000;

const log = createLogger();

let worker: Sql | undefined;
let gateway: Sql | undefined;

export function createRoleClient(url: string, applicationName: string): Sql {
  return postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: applicationName },
    onnotice: () => {},
  });
}

export function workerDb(): Sql {
  worker ??= createRoleClient(serverEnv().WORKER_DATABASE_URL, "pruva-system-worker");
  return worker;
}

export function gatewayDb(): Sql {
  gateway ??= withQueryDeadline(
    () => createRoleClient(serverEnv().GATEWAY_DATABASE_URL, "pruva-storefront-gateway"),
    {
      ms: GATEWAY_QUERY_DEADLINE_MS,
      onDeadline: ({ ms, retired }) =>
        log.warn("gateway: la base no respondió a tiempo; se reemplaza el pool", {
          deadline_ms: ms,
          retired,
        }),
    },
  );
  return gateway;
}
export type { Sql, TransactionSql } from "postgres";
