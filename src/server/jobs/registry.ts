import { workerDb } from "@/server/db/role-clients";
import { serverEnv } from "@/server/env";
import { createMediaHandlers } from "@/server/media/handlers";
import { emailChannel } from "@/server/notifications/channel";
import { createNotificationHandlers } from "@/server/notifications/handlers";
import { createStorageAdmin } from "@/server/privileged/storage-admin";
import { invalidateStore } from "@/server/storefront/cache";

import type { JobHandler, JobRegistry } from "./types";

/**
 * Registro de handlers por tipo de job. Cada módulo registra aquí sus handlers en
 * la fase que los introduce; un tipo sin handler termina en `dead` con
 * `unknown_job_type`. Las dependencias se resuelven al ejecutar, no al importar.
 */
function lazy(type: string, build: () => Array<[string, JobHandler]>): JobHandler {
  return async (job, context) => {
    await new Map(build()).get(type)!(job, context);
  };
}

const notifications = () =>
  createNotificationHandlers({
    db: workerDb(),
    channel: emailChannel(),
    appUrl: serverEnv().APP_URL,
  });
const media = () =>
  createMediaHandlers({
    db: workerDb(),
    storage: createStorageAdmin(),
    onPublished: invalidateStore,
  });

const handlers: Array<[string, JobHandler]> = [
  ["access.invitation_email", lazy("access.invitation_email", notifications)],
  ["access.support_access_notice", lazy("access.support_access_notice", notifications)],
  ["media.process", lazy("media.process", media)],
  ["media.purge_orphans", lazy("media.purge_orphans", media)],
];

export const jobRegistry: JobRegistry = new Map(handlers);
