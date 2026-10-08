import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { handleSendEmailHook } from "@/server/notifications/auth-hook";
import { fakeChannel } from "@/server/notifications/channels";
import { createLogger } from "@/server/observability/logger";
import { signStandardWebhook } from "@/server/security/standard-webhooks";

/** Send Email Hook de Supabase Auth (F7-T04b) como system_worker. */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const SECRET = `v1,whsec_${randomBytes(32).toString("base64")}`;
let channel = fakeChannel();

function call(payload: unknown, opts: { id?: string; secret?: string; ts?: number } = {}) {
  const body = JSON.stringify(payload);
  const id = opts.id ?? `msg_${randomBytes(6).toString("hex")}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  return handleSendEmailHook({
    secret: SECRET,
    headers: new Headers({
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": signStandardWebhook(opts.secret ?? SECRET, id, ts, body),
    }),
    rawBody: body,
    now: new Date(),
    db: worker,
    channel,
    log,
    otpMinutes: 10,
  });
}
const login = (email: string, token = "123456", redirect_to?: string) => ({
  user: { email },
  email_data: { token, email_action_type: "magiclink", ...(redirect_to ? { redirect_to } : {}) },
});

beforeEach(() => {
  channel = fakeChannel();
});
afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("Send Email Hook", () => {
  it("envía el código; un reintento de Auth con el mismo id no reenvía", async () => {
    const id = `msg_${randomBytes(6).toString("hex")}`;
    expect((await call(login("staff@hook.test"), { id })).status).toBe(200);
    expect((await call(login("staff@hook.test"), { id })).status).toBe(200);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.to).toBe("staff@hook.test");
    expect(channel.sent[0]!.text).toContain("123456");
    expect(channel.sent[0]!.subject).toBe("Tu código para entrar");
  });

  it("cambio de email: un código a cada dirección", async () => {
    const r = await call({
      user: { email: "viejo@hook.test", new_email: "nuevo@hook.test" },
      email_data: { token: "111111", token_new: "222222", email_action_type: "email_change" },
    });
    expect(r.status).toBe(200);
    expect(channel.sent.map((m) => [m.to, m.text.includes("111111") ? 1 : 2])).toEqual([
      ["viejo@hook.test", 1],
      ["nuevo@hook.test", 2],
    ]);
  });

  it("cambio de email sin modo seguro: el único código va al email nuevo", async () => {
    const r = await call({
      user: { email: "viejo@hook.test", new_email: "nuevo@hook.test" },
      email_data: { token: "333333", email_action_type: "email_change" },
    });
    expect(r.status).toBe(200);
    expect(channel.sent.map((m) => m.to)).toEqual(["nuevo@hook.test"]);
  });

  it("firma inválida o vieja: 401, sin envío y con evento de seguridad", async () => {
    const before = await admin<{ n: number }[]>`
      select count(*)::int as n from audit.security_events where type like 'auth.email_hook_%'`;
    const other = `v1,whsec_${randomBytes(32).toString("base64")}`;
    expect((await call(login("x@hook.test"), { secret: other })).status).toBe(401);
    expect(
      (await call(login("x@hook.test"), { ts: Math.floor(Date.now() / 1000) - 600 })).status,
    ).toBe(401);
    expect(channel.sent).toHaveLength(0);
    const after = await admin<{ n: number }[]>`
      select count(*)::int as n from audit.security_events where type like 'auth.email_hook_%'`;
    expect(after[0]!.n - before[0]!.n).toBe(2);
  });

  it("datos inesperados: 400 sin envío", async () => {
    expect((await call(login("no-es-email"))).status).toBe(400);
    expect((await call(login("a@hook.test", "<b>1</b>"))).status).toBe(400);
    expect(channel.sent).toHaveLength(0);
  });

  it("comprador: el código lleva la marca de la tienda solo con el nonce de SU petición", async () => {
    const run = randomBytes(3).toString("hex");
    const [plan] = await admin<{ id: string }[]>`
      insert into public.plans (key, name) values ('hook_plan', 'hook_plan')
      on conflict (key) do update set name = excluded.name returning id`;
    await admin`insert into public.plan_entitlements (plan_id, key, value_int)
                values (${plan!.id}, 'max_stores', 5) on conflict do nothing`;
    const [org] = await admin<{ id: string }[]>`
      insert into public.organizations (name, slug, country) values ('Org hk', ${`org-hk-${run}`}, 'MX') returning id`;
    await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
    const [store] = await admin<{ id: string }[]>`
      insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at, contact_email)
      values (${org!.id}, 'Panadería <La Espiga>', ${`hk-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(),
              'hola@espiga.test') returning id`;
    const buyer = `compra-${run}@hook.test`;
    const [intent] = await admin<{ nonce: string }[]>`
      select storefront.record_login_intent(${store!.id}, ${buyer}, ${"a".repeat(64)}) as nonce`;
    const redirect = `http://localhost:3000/?pruva_login=${intent!.nonce}`;
    expect((await call(login(buyer, "123456", redirect))).status).toBe(200);
    const m = channel.sent[0]!;
    expect(m.subject).toBe("Tu código para entrar a Panadería <La Espiga>");
    expect(m.fromName).toBe("Panadería <La Espiga>");
    // Sin Reply-To: un código de acceso no se responde (ni se reenvía a la tienda).
    expect(m.replyTo).toBeUndefined();
    expect(m.html).toContain("Panadería &lt;La Espiga&gt;");
    // La MISMA persona entrando al panel (sin el nonce, aunque haya un intento
    // reciente de otra tienda para su email) recibe la plantilla de la plataforma.
    channel = fakeChannel();
    await call(login(buyer, "654321"));
    expect(channel.sent[0]!.fromName).toBeUndefined();
    channel = fakeChannel();
    await call(login(buyer, "765432", "http://localhost:3000/?pruva_login=" + "0".repeat(32)));
    expect(channel.sent[0]!.fromName).toBeUndefined();
  });
});
