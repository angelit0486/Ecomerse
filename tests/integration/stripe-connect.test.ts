import { createHmac, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "@/server/observability/logger";
import { startStripeOnboarding, syncStripeAccount } from "@/server/payments/connect";
import { createStripeProvider } from "@/server/payments/stripe";
import { handleStripeWebhook } from "@/server/payments/webhook";

/** Onboarding de Stripe Connect y account.updated (F7-T06) con la API simulada. */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "whsec_connect0000000000000";
const ACCOUNT = `acct_${run}conn0000`;

const calls: { path: string; idempotencyKey: string | null }[] = [];
let chargesEnabled = false;
const fetchImpl = (async (url: string, init: RequestInit) => {
  const path = new URL(url).pathname;
  const headers = init.headers as Record<string, string>;
  calls.push({ path, idempotencyKey: headers["idempotency-key"] ?? null });
  if (path === "/v1/accounts") return Response.json({ id: ACCOUNT });
  if (path === "/v1/account_links")
    return Response.json({ url: "https://connect.stripe.test/setup/x" });
  if (path === `/v1/accounts/${ACCOUNT}`) {
    return Response.json({ charges_enabled: chargesEnabled, details_submitted: chargesEnabled });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
const provider = createStripeProvider({
  secretKey: "sk_test_connect000",
  webhookSecret: SECRET,
  apiBase: "https://stripe.test",
  fetchImpl,
});
let storeId: string;

const status = async () =>
  (
    await admin<{ status: string }[]>`
      select status from public.payment_accounts where store_id = ${storeId} and provider = 'stripe'`
  )[0]?.status;

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('cn_plan', 'cn_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org cn', ${`org-cn-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Tienda cn', ${`cn-${run}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  storeId = s!.id;
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("Stripe Connect", () => {
  const input = () => ({
    storeId,
    country: "MX",
    email: "hola@cn.test",
    existingAccountId: null,
    returnUrl: "https://panel.test/r",
    refreshUrl: "https://panel.test/f",
  });

  it("crea la cuenta con clave por tienda, la registra pendiente y devuelve el enlace", async () => {
    const url = await startStripeOnboarding(
      { db: worker, api: provider.api, mode: "test" },
      input(),
    );
    expect(url).toBe("https://connect.stripe.test/setup/x");
    expect(calls[0]).toEqual({
      path: "/v1/accounts",
      idempotencyKey: `connect-account:${storeId}`,
    });
    expect(await status()).toBe("pending");
    // Repetir: misma cuenta (Stripe devuelve la misma por la clave; la base conserva la primera).
    await startStripeOnboarding({ db: worker, api: provider.api, mode: "test" }, input());
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.payment_accounts where store_id = ${storeId} and provider = 'stripe'`;
    expect(n!.n).toBe(1);
  });

  it("solo la respuesta de Stripe activa la cuenta", async () => {
    expect(await syncStripeAccount({ db: worker, api: provider.api }, ACCOUNT)).toBe("pending");
    chargesEnabled = true;
    const body = JSON.stringify({
      id: `evt_${randomBytes(6).toString("hex")}`,
      type: "account.updated",
      account: ACCOUNT,
      created: Math.floor(Date.now() / 1000),
      // El cuerpo dice lo que quiera: se re-consulta a Stripe.
      data: { object: { id: ACCOUNT, object: "account", charges_enabled: false } },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
    const result = await handleStripeWebhook({
      db: worker,
      provider,
      headers: new Headers({ "stripe-signature": `t=${t},v1=${sig}` }),
      rawBody: body,
      now: new Date(),
      log,
    });
    expect(result.body.outcome).toBe("account_synced");
    expect(await status()).toBe("active");
  });
});
