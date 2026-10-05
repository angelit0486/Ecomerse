import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { emailChannel } from "@/server/notifications/channel";
import { createNotificationHandlers } from "@/server/notifications/handlers";

import type { JobHandler, JobRegistry } from "./types";

/**
 * Registro de handlers por tipo de job. Cada módulo registra aquí sus handlers en
 * la fase que los introduce; un tipo sin handler termina en `dead` con
 * `unknown_job_type`. Las dependencias se resuelven al ejecutar, no al importar.
 */
function lazy(type: string): JobHandler {
  return async (job, context) => {
    const handlers = new Map(
      createNotificationHandlers({
        db: workerDb(),
        channel: emailChannel(),
        appUrl: serverEnv().APP_URL,
      }),
    );
    await handlers.get(type)!(job, context);
  };
}

const handlers: Array<[string, JobHandler]> = [
  ["access.invitation_email", lazy("access.invitation_email")],
  ["access.support_access_notice", lazy("access.support_access_notice")],
];

export const jobRegistry: JobRegistry = new Map(handlers);
