import "server-only";

import postgres, { type Sql } from "postgres";

import { serverEnv } from "@/server/env";

/**
 * Clientes de base de datos de mínimo privilegio (GATE0 §11.4, ADR-016).
 *
 * - workerDb: rol `system_worker`. Solo puede ejecutar funciones `system.*`
 *   (cola de jobs, health). No tiene acceso a ninguna tabla.
 * - gatewayDb (`storefront_gateway`) se agrega en la fase que lo usa por primera vez.
 *
 * Conexión vía Supavisor en modo transacción: `prepare: false` es obligatorio y no
 * se usa estado de sesión (SET); todo pasa por llamadas a funciones.
 */

let worker: Sql | undefined;

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
