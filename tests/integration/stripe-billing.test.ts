import { createHmac } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleBillingWebhook, type BillingConfig } from "@/server/billing/stripe-billing";
import { StripeApi } from "@/server/payments/stripe";

/**
 * Webhook de Stripe Billing (ADR-044) contra PostgreSQL real con el rol
 * system_worker, como en producción: firma, idempotencia y efecto en la suscripción.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "whsec_billingintegration00";
const config: BillingConfig = {
  api: new StripeApi({ secretKey: "sk_test_0000000000", webhookSecret: SECRET }),
  webhookSecret: SECRET,
  live: false,
};
let orgId = "";
let planKey = "";

function sign(body: string) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
}

function event(
  id: string,
  status: string,
  created: number,
  type = "customer.subscription.updated",
) {
  return JSON.stringify({
    id,
    type,
    created,
    livemode: false,
    data: {
      object: {
        id: `sub_${run}`,
        customer: `cus_${run}`,
        status,
        current_period_end: created + 2_592_000,
        metadata: { organization_id: orgId, plan_key: planKey, interval: "monthly" },
      },
    },
  });
}

const deliver = (rawBody: string, signature: string | null = sign(rawBody)) =>
  handleBillingWebhook({
    db: worker,
    config,
    signature,
    rawBody,
    now: new Date(),
    requireLivemode: false,
  });

beforeAll(async () => {
  planKey = `ib_${run}`;
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name, status, price_monthly) values (${planKey}, 'Integración', 'active', 49900)
    returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 1), (${plan!.id}, 'max_staff', 5)`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org cobro', ${`org-cobro-${run}`}, 'MX')
    returning id`;
  orgId = org!.id;
  await admin`insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
              values (${orgId}, ${plan!.id}, 'trialing', now() + interval '5 days')`;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

async function subscription() {
  const [s] = await admin<
    { status: string; provider: string; provider_subscription_id: string | null }[]
  >`
    select status, provider, provider_subscription_id from public.subscriptions
     where organization_id = ${orgId} order by created_at desc limit 1`;
  return s;
}

describe("webhook de Stripe Billing con la base real", () => {
  it("un evento firmado activa la suscripción y repetirlo no hace nada", async () => {
    const t = Math.floor(Date.now() / 1000);
    const body = event(`evt_${run}a`, "active", t);
    expect(await deliver(body)).toEqual({
      status: 200,
      body: { received: true, outcome: "updated" },
    });
    expect(await subscription()).toEqual({
      status: "active",
      provider: "stripe",
      provider_subscription_id: `sub_${run}`,
    });
    expect((await deliver(body)).body).toEqual({ received: true, outcome: "duplicate" });
  });

  it("firma inválida: 401, nada cambia y queda un evento de seguridad", async () => {
    const body = event(`evt_${run}b`, "canceled", Math.floor(Date.now() / 1000) + 10);
    expect((await deliver(body, "t=1,v1=00")).status).toBe(401);
    expect((await subscription())!.status).toBe("active");
    const [sec] = await admin<{ n: number }[]>`
      select count(*)::int n from audit.security_events where type like 'billing.webhook_%'`;
    expect(sec!.n).toBeGreaterThan(0);
  });

  it("cancelada en Stripe: la organización queda sin suscripción vigente", async () => {
    const body = event(
      `evt_${run}c`,
      "active",
      Math.floor(Date.now() / 1000) + 20,
      "customer.subscription.deleted",
    );
    expect((await deliver(body)).body).toEqual({ received: true, outcome: "updated" });
    expect((await subscription())!.status).toBe("cancelled");
  });
});
