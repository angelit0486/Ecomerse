import { createHash } from "node:crypto";

import type { Sql } from "@/server/db/role-clients";
import type { JobHandler } from "@/server/jobs/types";
import { alreadyDelivered, sendNotification } from "@/server/notifications/handlers";
import { platformHealthAlertEmail } from "@/server/notifications/templates";
import type { EmailChannel } from "@/server/notifications/types";
import { describeIssue, healthSchema } from "@/lib/platform/health";

/**
 * Revisión de salud (misión vendible F1.6): cada 15 minutos lee
 * `system.platform_health()` y, si hay problemas, avisa por correo a dueño y
 * administración de la plataforma. Un correo por problema, destinatario y hora
 * (deduplicado en notification_deliveries). Sin problemas no envía nada.
 */
export interface HealthDeps {
  db: Sql;
  channel: EmailChannel;
  appUrl: string;
  now?: () => Date;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function createHealthHandlers(deps: HealthDeps): Array<[string, JobHandler]> {
  const check: JobHandler = async (_job, { log }) => {
    const [row] = await deps.db<{ h: unknown }[]>`select system.platform_health() as h`;
    const health = healthSchema.parse(row?.h);
    if (health.issues.length === 0) return;
    const recipients = await deps.db<{ email: string }[]>`
      select email from system.platform_alert_recipients()`;
    if (recipients.length === 0) {
      log.warn("platform.health_no_recipients", { issues: health.issues.length });
      return;
    }
    const hour = (deps.now?.() ?? new Date()).toISOString().slice(0, 13);
    const link = new URL("/platform/salud", deps.appUrl).toString();
    for (const issue of health.issues) {
      const { title, action } = describeIssue(issue);
      for (const { email } of recipients) {
        const dedupeKey = `platform.health:${issue.code}:${hour}:${hash(email)}`;
        if (await alreadyDelivered(deps.db, dedupeKey)) continue;
        await sendNotification(deps, {
          dedupeKey,
          template: "platform_health_alert",
          organizationId: null,
          idempotencyKey: dedupeKey,
          message: platformHealthAlertEmail({
            to: email,
            title,
            action,
            severity: issue.severity,
            link,
          }),
        });
      }
    }
  };
  return [["platform.health_check", check]];
}
