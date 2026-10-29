import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { createCartRecoveryHandlers } from "@/server/notifications/cart-recovery";
import { emailHashHex, verifyOptout } from "@/server/notifications/cart-recovery-links";
import { fakeChannel } from "@/server/notifications/channels";
import type { EmailChannel } from "@/server/notifications/types";
import { createLogger } from "@/server/observability/logger";

/** ADR-048: recordatorio de carritos como system_worker, enlaces y baja. */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "c".repeat(40);
let channel: EmailChannel & {
  sent: { to: string; html: string; text: string; listUnsubscribeUrl?: string }[];
} = fakeChannel();
let storeId: string;
let variantId: string;

const job = { id: "j", type: "carts.recover", payload: {}, storeId: null } as unknown as JobRecord;
const runJob = (ch: EmailChannel = channel) =>
  new Map(
    createCartRecoveryHandlers({
      db: worker,
      channel: ch,
      linkSecret: SECRET,
      storeOrigin: ({ hostname, handle }) => `https://${hostname ?? handle}`,
      appUrl: "https://panel.test",
    }),
  ).get("carts.recover")!(job, { log } as never);

async function abandonedCart(email: string, hoursAgo = 4): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, 2)`;
  const [c] = await admin<{ id: string }[]>`
    update public.carts set email = ${email}, last_activity_at = now() - make_interval(hours => ${hoursAgo})
     where store_id = ${storeId} and token_hash = app.cart_token_hash(${token}) returning id`;
  return c!.id;
}

function linkParams(text: string, path: string): URLSearchParams {
  const url = text.split(/\s/).find((w) => w.includes(path))!;
  return new URL(url).searchParams;
}

beforeAll(async () => {
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('cr_plan', 'cr_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org cr', ${`org-cr-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at, tax_rate_bps)
    values (${org!.id}, 'Tienda <b>', ${`cr-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), 0)
    returning id`;
  storeId = s!.id;
  await admin`insert into public.store_domains (store_id, hostname, type, status, is_primary)
              values (${storeId}, ${`cr-${run}.pruva.test`}, 'platform_subdomain', 'active', true)`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Proteína <i>', 'proteina', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`CR-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 50, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await admin`insert into public.store_notification_settings (store_id, cart_recovery) values (${storeId}, true)
              on conflict (store_id) do update set cart_recovery = true`;
});

beforeEach(() => {
  channel = fakeChannel();
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("recordatorio de carritos (ADR-048)", () => {
  it("un solo correo con enlace que recupera el carrito una vez", async () => {
    const cartId = await abandonedCart(`ana-${run}@cliente.test`);
    await runJob();
    await runJob();
    const mine = channel.sent.filter((m) => m.to === `ana-${run}@cliente.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.html).toContain("2 × Proteína &lt;i&gt;");
    expect(mine[0]!.html).not.toContain("<i>");
    // Baja en un clic (RFC 8058) hacia el panel, con la misma firma.
    const oneClick = new URL(mine[0]!.listUnsubscribeUrl!);
    expect(oneClick.origin + oneClick.pathname).toBe(
      "https://panel.test/api/email/unsubscribe/cart",
    );
    expect(oneClick.searchParams.get("store")).toBe(storeId);

    const t = linkParams(mine[0]!.text, "/carrito/recuperar").get("t")!;
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const fresh = randomBytes(32).toString("base64url");
    const [r1] = await admin<
      { ok: boolean }[]
    >`select storefront.cart_recover(${storeId}, ${t}, ${fresh}) as ok`;
    expect(r1!.ok).toBe(true);
    const [c] = await admin<{ id: string }[]>`
      select id from public.carts where token_hash = app.cart_token_hash(${fresh})`;
    expect(c!.id).toBe(cartId);
    const [r2] = await admin<{ ok: boolean }[]>`
      select storefront.cart_recover(${storeId}, ${t}, ${randomBytes(32).toString("base64url")}) as ok`;
    expect(r2!.ok).toBe(false);
  });

  it("la baja firmada usa el mismo hash que la base y detiene los recordatorios", async () => {
    const email = `beto-${run}@cliente.test`;
    await abandonedCart(email);
    await runJob();
    const msg = channel.sent.find((m) => m.to === email)!;
    const q = linkParams(msg.text, "/carrito/recordatorios");
    const h = q.get("h")!;
    expect(q.toString()).not.toContain("beto");
    expect(verifyOptout(SECRET, storeId, h, q.get("s"))).toBe(true);
    expect(verifyOptout(SECRET, storeId, emailHashHex("otra@cliente.test"), q.get("s"))).toBe(
      false,
    );
    const [db] = await admin<{ h: string; mixed: string }[]>`
      select encode(app.email_hash(${email}), 'hex') as h,
             encode(app.email_hash(${" Beto@Cliente.TEST "}), 'hex') as mixed`;
    expect(h).toBe(db!.h);
    expect(emailHashHex(" Beto@Cliente.TEST ")).toBe(db!.mixed);

    await admin`select storefront.cart_recovery_optout(${storeId}, ${h})`;
    await abandonedCart(email);
    channel = fakeChannel();
    await runJob();
    expect(channel.sent.filter((m) => m.to === email)).toHaveLength(0);
  });

  it("si un envío falla, los demás salen y no se reintenta", async () => {
    await abandonedCart(`falla-${run}@cliente.test`);
    await abandonedCart(`sale-${run}@cliente.test`);
    const sent: string[] = [];
    const flaky: EmailChannel = {
      provider: "fake",
      async send(m) {
        if (m.to.startsWith("falla-")) throw new Error("timeout");
        sent.push(m.to);
        return { providerMessageId: "x" };
      },
    };
    await expect(runJob(flaky)).resolves.toBeUndefined();
    expect(sent).toContain(`sale-${run}@cliente.test`);
    const [row] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.carts
       where store_id = ${storeId} and email = ${`falla-${run}@cliente.test`} and recovery_sent_at is not null`;
    expect(row!.n).toBe(1);
  });

  it("no escribe si la tienda lo apaga", async () => {
    await admin`update public.store_notification_settings set cart_recovery = false where store_id = ${storeId}`;
    await abandonedCart(`carla-${run}@cliente.test`);
    await runJob();
    expect(channel.sent).toHaveLength(0);
    await admin`update public.store_notification_settings set cart_recovery = true where store_id = ${storeId}`;
  });
});
