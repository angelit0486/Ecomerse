import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { createRetentionHandlers } from "@/server/maintenance/retention";
import { createLogger } from "@/server/observability/logger";

/**
 * ADR-060 contra PostgreSQL real con el rol system_worker: el trabajo diario
 * borra el carrito abandonado de 100 días y el correo de 13 meses, conserva el
 * carrito reciente, registra la corrida y repetirlo no falla ni borra de más.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const run = Math.random().toString(36).slice(2, 8);
const job: JobRecord = {
  id: "ret",
  type: "data.retention",
  storeId: null,
  payload: {},
  attempts: 1,
  maxAttempts: 3,
};
let storeId: string;
let oldCart: string;
let recentCart: string;

async function runJob() {
  const lines: string[] = [];
  const handler = new Map(createRetentionHandlers({ db: worker })).get("data.retention")!;
  await handler(job, {
    log: createLogger({ sink: (l) => lines.push(l) }),
    deadline: Date.now() + 60_000,
  });
  return lines.join("\n");
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ret_plan', 'ret_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ret ${run}`}, ${`org-ret-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status)
              values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda ret', ${`ret-${run}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
  const carts = await admin<{ id: string }[]>`
    insert into public.carts (store_id, token_hash, status, last_activity_at, email)
    values (${storeId}, sha256(${`ret-old-${run}`}::bytea), 'abandoned', now() - interval '100 days', 'ana@x.test'),
           (${storeId}, sha256(${`ret-new-${run}`}::bytea), 'abandoned', now() - interval '5 days', 'eva@x.test')
    returning id`;
  [oldCart, recentCart] = [carts[0]!.id, carts[1]!.id];
  await admin`insert into public.notification_deliveries
                (dedupe_key, channel, template, recipient_hash, organization_id, status, provider, created_at)
              values (${`ret:${run}:old`}, 'email', 'order_created', sha256('x'::bytea), ${org!.id}, 'sent', 'fake',
                      now() - interval '13 months'),
                     (${`ret:${run}:new`}, 'email', 'order_created', sha256('y'::bytea), ${org!.id}, 'sent', 'fake',
                      now() - interval '1 month')`;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("data.retention (ADR-060)", () => {
  it("borra lo vencido, conserva lo reciente y registra la corrida", async () => {
    const log = await runJob();
    expect(log).toContain("Retención de datos aplicada");
    const carts = await admin<{ id: string }[]>`
      select id from public.carts where id in (${oldCart}, ${recentCart})`;
    expect(carts.map((c) => c.id)).toEqual([recentCart]);
    const mails = await admin<{ dedupe_key: string }[]>`
      select dedupe_key from public.notification_deliveries where dedupe_key like ${`ret:${run}:%`}`;
    expect(mails.map((m) => m.dedupe_key)).toEqual([`ret:${run}:new`]);
    const [runRow] = await admin<{ fresh: boolean }[]>`
      select last_run_at > now() - interval '1 minute' as fresh
        from system.maintenance_runs where task = 'data.retention'`;
    expect(runRow?.fresh).toBe(true);
  });

  it("repetirlo no falla ni borra lo que sigue vigente", async () => {
    await runJob();
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.carts where id = ${recentCart}`;
    expect(n?.n).toBe(1);
  });
});
