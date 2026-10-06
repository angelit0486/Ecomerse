import type { Sql } from "@/server/db/role-clients";

import { PermanentJobError, type JobHandler, type JobRecord } from "@/server/jobs/types";

import { staffInvitationEmail, supportAccessNoticeEmail } from "./templates";
import { PermanentDeliveryError, type EmailChannel } from "./types";

/**
 * Handlers de notificaciones de la Fase 2. Idempotentes (GATE0 §27.3): si la
 * entrega ya consta en notification_deliveries, no se reenvía. Ningún token,
 * email ni código se escribe en logs.
 */
export interface NotificationDeps {
  db: Sql;
  channel: EmailChannel;
  appUrl: string;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function payloadId(job: JobRecord, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new PermanentJobError(`payload.${key} inválido`);
  }
  return value;
}

export async function sendNotification(
  deps: NotificationDeps,
  input: {
    dedupeKey: string;
    template: string;
    organizationId: string | null;
    message: Parameters<EmailChannel["send"]>[0];
    idempotencyKey?: string;
  },
): Promise<void> {
  try {
    const result = await deps.channel.send(input.message, {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    await deps.db`select system.record_notification_delivery(
      ${input.dedupeKey}, ${input.template}, ${input.message.to}, ${input.organizationId}::uuid,
      'sent', ${deps.channel.provider}, ${result.providerMessageId})`;
  } catch (error) {
    if (error instanceof PermanentDeliveryError) {
      await deps.db`select system.record_notification_delivery(
        ${input.dedupeKey}, ${input.template}, ${input.message.to}, ${input.organizationId}::uuid,
        'suppressed', ${deps.channel.provider}, null)`;
      return;
    }
    throw error;
  }
}

export async function alreadyDelivered(db: Sql, dedupeKey: string): Promise<boolean> {
  const [row] = await db<{ delivered: boolean }[]>`
    select system.notification_delivered(${dedupeKey}) as delivered`;
  return row?.delivered ?? false;
}

export function createNotificationHandlers(deps: NotificationDeps): Array<[string, JobHandler]> {
  const invitationEmail: JobHandler = async (job, { log }) => {
    const invitationId = payloadId(job, "invitation_id");
    const dedupeKey = `invitation:${invitationId}`;
    if (await alreadyDelivered(deps.db, dedupeKey)) return;

    // Emite un token nuevo (solo su hash queda en la base) y lo envía. Sin clave
    // de idempotencia del proveedor: un reintento lleva otro token.
    const [row] = await deps.db<
      {
        token: string;
        email: string;
        organization_name: string;
        store_name: string | null;
        expires_at: Date;
      }[]
    >`select * from system.issue_invitation_token(${invitationId}::uuid)`;
    if (!row) {
      log.info("Invitación no vigente: nada que enviar");
      return;
    }
    await sendNotification(deps, {
      dedupeKey,
      template: "staff_invitation",
      organizationId: null,
      message: staffInvitationEmail({
        to: row.email,
        organizationName: row.organization_name,
        storeName: row.store_name,
        link: new URL(`/invitacion/${row.token}`, deps.appUrl).toString(),
        expiresAt: row.expires_at,
      }),
    });
  };

  const supportNotice: JobHandler = async (job, { log }) => {
    const grantId = payloadId(job, "grant_id");
    const dedupeKey = `support_notice:${grantId}`;
    if (await alreadyDelivered(deps.db, dedupeKey)) return;

    const [row] = await deps.db<
      {
        organization_id: string;
        owner_email: string;
        owner_name: string | null;
        store_name: string;
        reason: string;
        minutes: number;
        expires_at: Date;
      }[]
    >`select * from system.get_support_access_notice(${grantId}::uuid)`;
    if (!row) {
      log.info("Concesión no vigente: nada que avisar");
      return;
    }
    await sendNotification(deps, {
      dedupeKey,
      template: "support_access_notice",
      organizationId: row.organization_id,
      idempotencyKey: dedupeKey,
      message: supportAccessNoticeEmail({
        to: row.owner_email,
        ownerName: row.owner_name,
        storeName: row.store_name,
        reason: row.reason,
        minutes: row.minutes,
        expiresAt: row.expires_at,
        panelLink: new URL("/admin", deps.appUrl).toString(),
      }),
    });
  };

  return [
    ["access.invitation_email", invitationEmail],
    ["access.support_access_notice", supportNotice],
  ];
}
