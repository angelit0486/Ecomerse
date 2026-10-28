import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { fakeChannel } from "@/server/notifications/channels";
import { createLogger } from "@/server/observability/logger";
import { createHealthHandlers } from "@/server/platform/health-handlers";

/**
 * Revisión de salud como system_worker (misión vendible F1.6). Cada caso corre en
 * una transacción que se revierte: la base es compartida con otras pruebas y aquí
 * se vacía la cola para controlar qué problemas hay.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const ADMIN_EMAIL = `alertas-${run}@plataforma.test`;
const SUPPORT_EMAIL = `soporte-${run}@plataforma.test`;
const job = { id: "h1", type: "platform.health_check", payload: {} } as unknown as JobRecord;

class Rollback extends Error {}

/** Corre `fn` como system_worker dentro de una transacción que siempre se revierte. */
async function asWorker(fn: (tx: postgres.Sql) => Promise<void>) {
  await admin
    .begin(async (tx) => {
      const [a] = await tx<{ id: string }[]>`
        insert into auth.users (id, email) values (gen_random_uuid(), ${ADMIN_EMAIL}) returning id`;
      const [s] = await tx<{ id: string }[]>`
        insert into auth.users (id, email) values (gen_random_uuid(), ${SUPPORT_EMAIL}) returning id`;
      await tx`insert into public.platform_staff (user_id, role)
               values (${a!.id}, 'platform_admin'), (${s!.id}, 'platform_support')`;
      await tx`delete from system.jobs`;
      await tx`set local role system_worker`;
      await fn(tx as unknown as postgres.Sql);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
}

afterAll(() => admin.end());

describe("platform.health_check", () => {
  it("con la cola detenida avisa una sola vez por hora a la administración", async () => {
    await asWorker(async (tx) => {
      const channel = fakeChannel();
      const now = () => new Date("2026-10-28T10:05:00Z");
      const [check] = createHealthHandlers({
        db: tx,
        channel,
        appUrl: "https://panel.test",
        now,
      }).map(([, h]) => h);
      await tx`reset role`;
      await tx`insert into system.jobs (type, payload, status, run_after)
               values ('orders.expire', '{}', 'queued', now() - interval '20 minutes')`;
      await tx`set local role system_worker`;

      await check!(job, { log } as never);
      await check!(job, { log } as never);

      const mine = channel.sent.filter((m) => m.to === ADMIN_EMAIL);
      const stalled = mine.filter((m) => m.subject.includes("cola de trabajos"));
      expect(stalled).toHaveLength(1);
      expect(stalled[0]!.subject).toMatch(/^Urgente: /);
      expect(stalled[0]!.text).toContain("https://panel.test/platform/salud");
      expect(channel.sent.some((m) => m.to === SUPPORT_EMAIL)).toBe(false);

      // La hora siguiente vuelve a avisar si el problema sigue.
      const [later] = createHealthHandlers({
        db: tx,
        channel,
        appUrl: "https://panel.test",
        now: () => new Date("2026-10-28T11:05:00Z"),
      }).map(([, h]) => h);
      await later!(job, { log } as never);
      expect(
        channel.sent.filter((m) => m.to === ADMIN_EMAIL && m.subject.includes("cola de trabajos")),
      ).toHaveLength(2);
    });
  });

  it("system_worker no puede usar la versión del panel (solo la de system)", async () => {
    await asWorker(async (tx) => {
      await expect(tx`select public.platform_health()`).rejects.toThrow();
    });
  });
});
