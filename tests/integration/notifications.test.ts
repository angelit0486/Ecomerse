import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { runJobs } from "@/server/jobs/runner";
import { createPostgresJobStore } from "@/server/jobs/store";
import { fakeChannel } from "@/server/notifications/channels";
import { createNotificationHandlers } from "@/server/notifications/handlers";
import { createLogger } from "@/server/observability/logger";

/**
 * Jobs de notificación de la Fase 2 contra PostgreSQL real con el rol
 * system_worker (sin acceso a tablas). Ejecutar con `pnpm db:test`.
 */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL!;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL!;
const admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
const worker = postgres(workerUrl, { max: 4, prepare: false, onnotice: () => {} });
const store = createPostgresJobStore(worker);

let logLines: string[] = [];
const log = createLogger({ sink: (line) => logLines.push(line) });
let channel = fakeChannel();

async function run() {
  return runJobs({
    store,
    registry: new Map(
      createNotificationHandlers({ db: worker, channel, appUrl: "https://app.x.test" }),
    ),
    workerId: "test",
    log,
  });
}

async function tenant(key: string) {
  const [user] = await admin<{ id: string }[]>`
    insert into auth.users (id, email) values (gen_random_uuid(), ${`owner-${key}@x.test`}) returning id`;
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('notif_plan', 'notif_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_staff', 20) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values (${`Org <b>${key}</b>`}, ${`org-${key}`}, 'MX')
    returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${org!.id}, ${user!.id}, 'org_owner')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, ${`Tienda ${key}`}, ${`notif-${key}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  return { orgId: org!.id, storeId: s!.id, ownerId: user!.id };
}

async function invite(orgId: string, email: string) {
  const [inv] = await admin<{ id: string }[]>`
    insert into public.organization_invitations (organization_id, email, org_role, expires_at)
    values (${orgId}, ${email}, 'org_member', now() + interval '7 days') returning id`;
  await admin`select app.enqueue_job('access.invitation_email', ${admin.json({ invitation_id: inv!.id })},
                                     null, ${`invitation:${inv!.id}`})`;
  return inv!.id;
}

beforeEach(async () => {
  await admin`delete from system.jobs`;
  channel = fakeChannel();
  logLines = [];
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("access.invitation_email", () => {
  it("envía el enlace con un token cuyo hash coincide y que no aparece en logs", async () => {
    const t = await tenant("i1");
    const invitationId = await invite(t.orgId, "nuevo@x.test");

    const result = await run();
    expect(result.succeeded).toBe(1);
    expect(channel.sent).toHaveLength(1);
    const email = channel.sent[0]!;
    expect(email.to).toBe("nuevo@x.test");
    const token = /\/invitacion\/([0-9a-f]{64})/.exec(email.text)?.[1];
    expect(token).toBeDefined();
    expect(email.html).not.toContain("<b>i1</b>");

    const [row] = await admin<{ ok: boolean }[]>`
      select token_hash = sha256(convert_to(${token!}, 'UTF8')) as ok
        from public.organization_invitations where id = ${invitationId}`;
    expect(row!.ok).toBe(true);

    const [job] = await admin<{ payload: unknown; last_error: string | null }[]>`
      select payload, last_error from system.jobs limit 1`;
    expect(JSON.stringify(job)).not.toContain(token!);
    expect(logLines.join("\n")).not.toContain(token!);
    expect(logLines.join("\n")).not.toContain("nuevo@x.test");
  });

  it("no reenvía si la entrega ya consta (job repetido)", async () => {
    const t = await tenant("i2");
    const invitationId = await invite(t.orgId, "dos@x.test");
    await run();
    await admin`select app.enqueue_job('access.invitation_email', ${admin.json({ invitation_id: invitationId })})`;
    await run();
    expect(channel.sent).toHaveLength(1);
  });

  it("una invitación revocada no se envía y el job termina bien", async () => {
    const t = await tenant("i3");
    const invitationId = await invite(t.orgId, "tres@x.test");
    await admin`update public.organization_invitations set revoked_at = now() where id = ${invitationId}`;
    const result = await run();
    expect(result.succeeded).toBe(1);
    expect(channel.sent).toHaveLength(0);
  });

  it("payload inválido: dead sin reintentos", async () => {
    await admin`select app.enqueue_job('access.invitation_email', ${admin.json({ invitation_id: "x" })})`;
    const result = await run();
    expect(result.dead).toBe(1);
  });
});

describe("access.support_access_notice", () => {
  it("avisa al dueño con motivo y duración; una sola vez", async () => {
    const t = await tenant("s1");
    const [staff] = await admin<{ id: string }[]>`
      insert into auth.users (id, email) values (gen_random_uuid(), 'soporte-s1@platform.test') returning id`;
    const [granter] = await admin<{ id: string }[]>`
      insert into auth.users (id, email) values (gen_random_uuid(), 'admin-s1@platform.test') returning id`;
    const [grant] = await admin<{ id: string }[]>`
      insert into public.support_access_grants
        (organization_id, store_id, grantee_user_id, granted_by, reason, starts_at, expires_at)
      values (${t.orgId}, ${t.storeId}, ${staff!.id}, ${granter!.id},
              'Ticket 5: revisar pagos que no se confirman', now(), now() + interval '20 minutes')
      returning id`;
    await admin`select app.enqueue_job('access.support_access_notice', ${admin.json({ grant_id: grant!.id })})`;
    await admin`select app.enqueue_job('access.support_access_notice', ${admin.json({ grant_id: grant!.id })})`;

    await run();
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.to).toBe("owner-s1@x.test");
    expect(channel.sent[0]!.text).toContain("20 minutos");
    expect(channel.sent[0]!.text).toContain("Ticket 5");

    const [delivery] = await admin<{ status: string; org: string }[]>`
      select status, organization_id as org from public.notification_deliveries
       where dedupe_key = ${`support_notice:${grant!.id}`}`;
    expect(delivery).toEqual({ status: "sent", org: t.orgId });
  });

  it("si la concesión ya se revocó, no se avisa", async () => {
    const t = await tenant("s2");
    const [staff] = await admin<{ id: string }[]>`
      insert into auth.users (id, email) values (gen_random_uuid(), 'soporte-s2@platform.test') returning id`;
    const [grant] = await admin<{ id: string }[]>`
      insert into public.support_access_grants
        (organization_id, store_id, grantee_user_id, granted_by, reason, starts_at, expires_at, revoked_at)
      values (${t.orgId}, ${t.storeId}, ${staff!.id}, ${t.ownerId},
              'Ticket 6: revisar la configuración del envío', now(), now() + interval '20 minutes', now())
      returning id`;
    await admin`select app.enqueue_job('access.support_access_notice', ${admin.json({ grant_id: grant!.id })})`;
    await run();
    expect(channel.sent).toHaveLength(0);
  });
});
