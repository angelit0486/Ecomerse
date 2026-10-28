import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "@/server/observability/logger";
import { createMercadoPagoProvider, MercadoPagoApi } from "@/server/payments/mercadopago";
import {
  connectWithCode,
  createTokenResolver,
  refreshDueAccounts,
  type CredentialDeps,
} from "@/server/payments/mercadopago-credentials";
import { handleMercadoPagoWebhook } from "@/server/payments/mercadopago-webhook";

/**
 * ADR-041 contra PostgreSQL real (rol system_worker) y Mercado Pago simulado: cada
 * comercio conecta su cuenta, sus llaves quedan cifradas, el cobro se re-consulta
 * con SU llave (con la de otro comercio no se ve) y la renovación las reemplaza.
 */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 4, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 4,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "mpoauthintegration000000";
const PLATFORM = "APP_USR-0000000000000000-000000-plataforma-000";
const key = randomBytes(32);

/** Una cuenta de comercio en el Mercado Pago simulado: su id y sus llaves vigentes. */
interface Seller {
  id: string;
  token: string;
  refresh: string;
}
const sellers = new Map<string, Seller>(); // por código de autorización
const byToken = new Map<string, Seller>();
const payments = new Map<string, Record<string, unknown> & { collector_id: number }>();
let tokenCalls = 0;

function newSeller(): { code: string; seller: Seller } {
  const id = String(randomInt(100_000_000, 999_999_999));
  const seller = {
    id,
    token: `APP_USR-${randomBytes(12).toString("hex")}-${id}`,
    refresh: `TG-${randomBytes(8).toString("hex")}`,
  };
  const code = `TG-${randomBytes(10).toString("hex")}`;
  sellers.set(code, seller);
  byToken.set(seller.token, seller);
  return { code, seller };
}

const fetchImpl = (async (url: string, init: RequestInit = {}) => {
  const u = new URL(url);
  const auth = new Headers(init.headers).get("authorization")?.replace("Bearer ", "") ?? "";
  if (u.pathname === "/oauth/token") {
    tokenCalls += 1;
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    let seller: Seller | undefined;
    if (body.grant_type === "authorization_code") seller = sellers.get(body.code!);
    else seller = [...byToken.values()].find((s) => s.refresh === body.refresh_token);
    if (!seller) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    if (body.grant_type === "refresh_token") {
      byToken.delete(seller.token);
      seller.token = `APP_USR-${randomBytes(12).toString("hex")}-${seller.id}`;
      seller.refresh = `TG-${randomBytes(8).toString("hex")}`;
      byToken.set(seller.token, seller);
    }
    return new Response(
      JSON.stringify({
        access_token: seller.token,
        refresh_token: seller.refresh,
        user_id: Number(seller.id),
        expires_in: 15552000,
        live_mode: false,
      }),
    );
  }
  const seller = byToken.get(auth);
  if (u.pathname === "/users/me") {
    return seller
      ? new Response(JSON.stringify({ id: Number(seller.id), site_id: "MLM" }))
      : new Response("{}", { status: 401 });
  }
  const id = u.pathname.split("/").pop()!;
  const p = payments.get(id);
  // Solo el dueño del cobro lo ve: con la llave de otra cuenta Mercado Pago responde 404.
  if (!p || !seller || String(p.collector_id) !== seller.id) {
    return new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
  }
  return new Response(JSON.stringify(p));
}) as unknown as typeof fetch;

const oauth = {
  clientId: "1234567890",
  clientSecret: "s".repeat(24), // valor de prueba evidente
  redirectUri: "https://app.test/api/payments/mercadopago/callback",
  apiBase: "https://mp.test",
  fetchImpl,
};
const deps: CredentialDeps = { db: worker, key, oauth, platformToken: PLATFORM };
const api = new MercadoPagoApi({
  accessToken: PLATFORM,
  webhookSecret: SECRET,
  apiBase: "https://mp.test",
  fetchImpl,
});
const provider = createMercadoPagoProvider({
  accessToken: PLATFORM,
  webhookSecret: SECRET,
  apiBase: "https://mp.test",
  fetchImpl,
  tokenFor: createTokenResolver(deps),
});

async function newStore(tag: string): Promise<{ storeId: string; variantId: string }> {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('mpo_plan', 'mpo_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country)
    values (${`Org ${tag}`}, ${`org-mpo-${tag}-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at,
                               prices_include_tax, tax_rate_bps)
    values (${org!.id}, ${`Tienda ${tag}`}, ${`mpo-${tag}-${run}`}, 'MXN', 'MX', 'America/Mazatlan', 'active', now(), true, 0)
    returning id`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${s!.id}, 'Proteína', 'proteina', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${s!.id}, ${p!.id}, ${`MPO-${tag}-${run}`}, 10000, '', false) returning id`;
  await admin`select app.apply_inventory_movement(${s!.id}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${v!.id}`;
  return { storeId: s!.id, variantId: v!.id };
}

async function order(storeId: string, variantId: string, accountId: string) {
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, 1)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token},
      ${admin.json({ email: `c-${randomBytes(3).toString("hex")}@example.test`, customer_name: "C", payment_account_id: accountId })},
      ${10000}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  await admin`select storefront.record_checkout_result(${storeId}, ${o!.r.payment.id}, true,
                                                       ${`pref-${randomBytes(6).toString("hex")}`})`;
  return { orderId: o!.r.order_id, paymentId: o!.r.payment.id };
}

function deliver(dataId: string, user: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = randomBytes(8).toString("hex");
  const sig = createHmac("sha256", SECRET)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return handleMercadoPagoWebhook({
    db: worker,
    provider,
    url: new URL(
      `https://app.test/api/webhooks/payments/mercadopago?data.id=${dataId}&type=payment`,
    ),
    headers: new Headers({
      "x-signature": `ts=${ts},v1=${sig}`,
      "x-upstream-request-id": requestId,
    }),
    rawBody: JSON.stringify({
      id: randomInt(1_000_000, 9_999_999_999),
      type: "payment",
      action: "payment.updated",
      user_id: user,
      live_mode: false,
      data: { id: dataId },
    }),
    now: new Date(),
    log,
  });
}

let a: { storeId: string; variantId: string; accountId: string; seller: Seller };
let b: { storeId: string; variantId: string; accountId: string; seller: Seller };

beforeAll(async () => {
  for (const tag of ["a", "b"] as const) {
    const store = await newStore(tag);
    const { code, seller } = newSeller();
    const r = await connectWithCode(
      { ...deps, oauth, api, mode: "test" },
      { storeId: store.storeId, code, verifier: "verificador" },
    );
    if (!r.ok) throw new Error(r.reason);
    const value = { ...store, accountId: r.accountId, seller };
    if (tag === "a") a = value;
    else b = value;
  }
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("Mercado Pago por tienda (ADR-041)", () => {
  it("cada tienda queda con su propia cuenta y sus llaves cifradas", async () => {
    expect(a.accountId).not.toBe(b.accountId);
    const rows = await admin<{ access_token_enc: string }[]>`
      select access_token_enc from system.payment_credentials where store_id in (${a.storeId}, ${b.storeId})`;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.access_token_enc.startsWith("v1.")).toBe(true);
      expect(r.access_token_enc).not.toContain("APP_USR");
    }
    const resolve = createTokenResolver(deps);
    expect(
      await resolve({ id: a.accountId, provider: "mercadopago", mode: "test", publicConfig: {} }),
    ).toBe(a.seller.token);
    expect(
      await resolve({ id: b.accountId, provider: "mercadopago", mode: "test", publicConfig: {} }),
    ).toBe(b.seller.token);
  });

  it("el cobro de la tienda A se confirma con la llave de A (el dinero está en su cuenta)", async () => {
    const o = await order(a.storeId, a.variantId, a.accountId);
    const id = String(randomInt(1_000_000, 9_999_999_999));
    payments.set(id, {
      id: Number(id),
      status: "approved",
      transaction_amount: 100,
      currency_id: "MXN",
      external_reference: o.paymentId,
      payment_type_id: "credit_card",
      collector_id: Number(a.seller.id),
    });
    const r = await deliver(id, a.seller.id);
    expect(r.status).toBe(200);
    const [row] = await admin<
      { status: string }[]
    >`select status from public.orders where id = ${o.orderId}`;
    expect(row!.status).not.toBe("pending_payment");
  });

  it("un evento con el collector de B no puede confirmar un cobro de A", async () => {
    const o = await order(a.storeId, a.variantId, a.accountId);
    const id = String(randomInt(1_000_000, 9_999_999_999));
    payments.set(id, {
      id: Number(id),
      status: "approved",
      transaction_amount: 100,
      currency_id: "MXN",
      external_reference: o.paymentId,
      collector_id: Number(a.seller.id),
    });
    const r = await deliver(id, b.seller.id);
    expect(r.status).toBe(500); // con la llave de B Mercado Pago no muestra el cobro de A
    const [row] = await admin<
      { status: string }[]
    >`select status from public.orders where id = ${o.orderId}`;
    expect(row!.status).toBe("pending_payment");
  });

  it("las llaves por vencer se renuevan y se guardan las nuevas", async () => {
    await admin`update system.payment_credentials set expires_at = now() + interval '5 days'
                 where payment_account_id = ${b.accountId}`;
    const before = b.seller.token;
    const calls = tokenCalls;
    expect(await refreshDueAccounts(deps)).toBeGreaterThanOrEqual(1);
    expect(tokenCalls).toBeGreaterThan(calls);
    expect(b.seller.token).not.toBe(before);
    const resolve = createTokenResolver(deps);
    expect(
      await resolve({ id: b.accountId, provider: "mercadopago", mode: "test", publicConfig: {} }),
    ).toBe(b.seller.token);
  });

  it("una cuenta de prueba no se conecta en producción", async () => {
    const store = await newStore("c");
    const { code } = newSeller();
    const r = await connectWithCode(
      { ...deps, oauth, api, mode: "live" },
      { storeId: store.storeId, code, verifier: "v" },
    );
    expect(r).toEqual({ ok: false, reason: "mode_mismatch" });
  });
});
