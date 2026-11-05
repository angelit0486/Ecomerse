import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { fakeChannel } from "@/server/notifications/channels";
import { createWeeklySummaryHandlers } from "@/server/notifications/weekly-summary";
import { createLogger } from "@/server/observability/logger";

/**
 * Resumen semanal (paso 19) contra PostgreSQL real con el rol system_worker: solo
 * a las tiendas con el interruptor, a sus destinatarios, y un reintento del
 * trabajo no repite el correo.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
let storeOn: string;
let storeOff: string;

async function store(handle: string, staff: string[]) {
  // Como las demás pruebas de integración: plan con límites y suscripción activa.
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ws_plan', 'ws_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values (${`Org ${handle}`}, ${`org-${handle}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at, contact_email)
    values (${org!.id}, ${`Tienda ${handle}`}, ${handle}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(),
            ${`hola@${handle}.test`}) returning id`;
  if (staff.length) {
    await admin`insert into public.store_notification_settings (store_id, staff_emails) values (${s!.id}, ${staff})`;
  }
  await admin`insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                           requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                           subtotal, total, status, payment_status, fulfillment_status, placed_at, paid_at, paid_total)
              values (${s!.id}, 1, '#1', ${`ws-${handle}-000000000000`}, 'c@x.test', 'C', false, 'MXN', true, 0, false,
                      12300, 12300, 'open', 'paid', 'unfulfilled', now() - interval '1 day', now() - interval '1 day', 12300)`;
  return s!.id;
}

beforeAll(async () => {
  storeOn = await store(`ws-on-${run}`, ["ventas@on.test", "dueña@on.test"]);
  storeOff = await store(`ws-off-${run}`, []);
  await admin`insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
              values ('weekly_summary', 'store', ${storeOn}, true, 'integración paso 19')`;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("resumen semanal", () => {
  it("una vez por semana a los destinatarios de la tienda que lo encendió", async () => {
    const channel = fakeChannel();
    const handler = new Map(
      createWeeklySummaryHandlers({ db: worker, channel, appUrl: "https://panel.test" }),
    ).get("stores.weekly_summary")!;
    const job = {
      id: "j",
      type: "stores.weekly_summary",
      payload: { week: "2099-S01" }, // la clave de envío ya es única por tienda
      storeId: null,
    } as unknown as JobRecord;
    await handler(job, { log } as never);
    await handler(job, { log } as never);
    const mine = channel.sent.filter((m) => m.subject.includes(`ws-on-${run}`));
    expect(mine.map((m) => m.to).sort()).toEqual(["dueña@on.test", "ventas@on.test"]);
    expect(mine[0]!.text).toContain("Ventas (7 días): $123.00");
    expect(mine[0]!.text).toContain("- 1 pedido(s) por surtir");
    expect(channel.sent.some((m) => m.subject.includes(`ws-off-${run}`))).toBe(false);
    expect(storeOff).toBeTruthy();
  });
});
