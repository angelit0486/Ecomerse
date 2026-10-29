import { createHash, randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { JobRecord } from "@/server/jobs/types";
import { fakeChannel } from "@/server/notifications/channels";
import { PermanentDeliveryError, type EmailChannel } from "@/server/notifications/types";
import { createOrderNotificationHandlers } from "@/server/notifications/order-handlers";
import { createLogger } from "@/server/observability/logger";
import { guestToken } from "@/server/payments/order-links";

/** Notificaciones de pedidos como system_worker (GATE0 §27.2-27.3). */
const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 2, onnotice: () => {} });
const worker = postgres(process.env.TEST_WORKER_DATABASE_URL!, {
  max: 2,
  prepare: false,
  onnotice: () => {},
});
const log = createLogger({ sink: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const SECRET = "s".repeat(40);
let channel = fakeChannel();
let storeId: string;
let otherStoreId: string;
let variantId: string;

function handlers() {
  return new Map(
    createOrderNotificationHandlers({
      db: worker,
      channel,
      linkSecret: SECRET,
      storeOrigin: (host) => `https://${host}`,
      mediaUrl: (path) => `https://media.test/${path}`,
      appUrl: "https://panel.test",
    }),
  );
}
const job = (type: string, payload: Record<string, unknown>, store = storeId) =>
  ({ id: randomBytes(4).toString("hex"), type, payload, storeId: store }) as unknown as JobRecord;
const runJob = (type: string, payload: Record<string, unknown>, store?: string) =>
  handlers().get(type)!(job(type, payload, store), { log } as never);

async function placeOrder(provider: "manual" | "fake", name = "Ana") {
  const [acct] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${storeId} and provider = ${provider}`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${variantId}, 2)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${storeId}, ${token}, ${admin.json({
      email: "comprador@example.test",
      customer_name: name,
      payment_account_id: acct!.id,
    })}, 20000, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  return { orderId: o!.r.order_id, paymentId: o!.r.payment.id, idem };
}

beforeAll(async () => {
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do update set value = excluded.value`;
  const [plan] = await admin<{ id: string }[]>`
    insert into public.plans (key, name) values ('ntf_plan', 'ntf_plan')
    on conflict (key) do update set name = excluded.name returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${plan!.id}, 'max_stores', 5), (${plan!.id}, 'max_products', 100) on conflict do nothing`;
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, slug, country) values ('Org nt', ${`org-nt-${run}`}, 'MX') returning id`;
  await admin`insert into public.subscriptions (organization_id, plan_id, status) values (${org!.id}, ${plan!.id}, 'active')`;
  const [s] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone, status, launched_at,
                               tax_rate_bps, contact_email)
    values (${org!.id}, 'Tienda <b>&</b>', ${`nt-${run}`}, 'MXN', 'MX', 'America/Mexico_City', 'active', now(), 0,
            'hola@tienda.test') returning id`;
  storeId = s!.id;
  const [s2] = await admin<{ id: string }[]>`
    insert into public.stores (organization_id, name, handle, currency, country, timezone)
    values (${org!.id}, 'Otra', ${`nt2-${run}`}, 'MXN', 'MX', 'America/Mexico_City') returning id`;
  otherStoreId = s2!.id;
  await admin`insert into public.store_domains (store_id, hostname, type, status, is_primary)
              values (${storeId}, ${`nt-${run}.pruva.test`}, 'platform_subdomain', 'active', true)`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${storeId}, 'Taza <script>', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${storeId}, ${p!.id}, ${`NT-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${storeId}, l.id, 'initial', 50, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config) values
    (${storeId}, 'manual', 'active', 'Transferencia', ${admin.json({ instructions: "CLABE 0123" })}),
    (${storeId}, 'fake', 'active', 'Prueba', '{}')`;
});

beforeEach(() => {
  channel = fakeChannel();
});

afterAll(async () => {
  await Promise.all([admin.end(), worker.end()]);
});

describe("notificaciones de pedidos", () => {
  it("pago diferido: comprador + tienda al crearse; reprocesar no reenvía", async () => {
    const { orderId, idem } = await placeOrder("manual", "<img src=x>");
    await runJob("order.created", { order_id: orderId });
    await runJob("order.created", { order_id: orderId });
    expect(channel.sent.map((m) => m.to).sort()).toEqual([
      "comprador@example.test",
      "hola@tienda.test",
    ]);
    const buyer = channel.sent.find((m) => m.to === "comprador@example.test")!;
    expect(buyer.fromName).toBe("Tienda <b>&</b>");
    expect(buyer.replyTo).toBe("hola@tienda.test");
    expect(buyer.html).toContain("CLABE 0123");
    expect(buyer.html).not.toContain("<img src=x>");
    expect(buyer.html).not.toContain("<script>");
    expect(buyer.html).toContain("&lt;img src=x&gt;");
    const link = `https://nt-${run}.pruva.test/pedido/${orderId}?t=${guestToken(SECRET, idem)}`;
    expect(buyer.text).toContain(link);
    const staff = channel.sent.find((m) => m.to === "hola@tienda.test")!;
    expect(staff.text).toContain(`https://panel.test/admin/nt-${run}/pedidos/${orderId}`);
    expect(staff.text).not.toContain("comprador@example.test");
    const [d] = await admin<{ n: number }[]>`
      select count(*)::int as n from public.notification_deliveries where dedupe_key like ${`order.created:${orderId}:%`}`;
    expect(d!.n).toBe(2);
  });

  it("pago en línea: nada al crearse; confirmación y aviso a la tienda configurada al pagarse", async () => {
    await admin`insert into public.store_notification_settings (store_id, staff_emails, notify_new_order, notify_paid)
                values (${storeId}, '{ventas@tienda.test,bodega@tienda.test}', true, true)
                on conflict (store_id) do update set staff_emails = excluded.staff_emails`;
    const { orderId, paymentId } = await placeOrder("fake");
    await runJob("order.created", { order_id: orderId });
    expect(channel.sent).toHaveLength(0);
    await admin`select app.confirm_order_payment(${paymentId}, 'system', 'fake')`;
    await runJob("order.paid", { order_id: orderId });
    await runJob("order.paid", { order_id: orderId });
    expect(channel.sent.map((m) => m.to).sort()).toEqual([
      "bodega@tienda.test",
      "comprador@example.test",
      "ventas@tienda.test",
    ]);
    await admin`delete from public.store_notification_settings where store_id = ${storeId}`;
  });

  it("job de otra tienda: no obtiene ni envía nada del pedido", async () => {
    const { orderId } = await placeOrder("manual");
    await expect(runJob("order.created", { order_id: orderId }, otherStoreId)).rejects.toThrow(
      "no coincide",
    );
    expect(channel.sent).toHaveLength(0);
  });

  it("payload inválido: error permanente", async () => {
    await expect(runJob("order.paid", { order_id: "x" })).rejects.toThrow("payload.order_id");
  });

  it("entregado: aviso con invitación a opinar en la página del pedido; una sola vez", async () => {
    const { orderId, paymentId, idem } = await placeOrder("fake");
    await admin`select app.confirm_order_payment(${paymentId}, 'system', 'fake')`;
    const [sh] = await admin<{ id: string }[]>`
      insert into public.shipments (store_id, order_id, status, shipped_at, delivered_at, idempotency_key)
      values (${storeId}, ${orderId}, 'delivered', now(), now(), ${`ntf-del-${randomBytes(8).toString("hex")}`})
      returning id`;
    await runJob("order.delivered", { order_id: orderId, shipment_id: sh!.id });
    await runJob("order.delivered", { order_id: orderId, shipment_id: sh!.id });
    expect(channel.sent).toHaveLength(1);
    const mail = channel.sent[0]!;
    expect(mail.subject).toContain("fue entregado");
    expect(mail.text).toContain(`/pedido/${orderId}?t=${guestToken(SECRET, idem)}#opinar`);
  });

  it("cancelación y reembolso confirmado: un aviso cada uno", async () => {
    const { orderId, paymentId } = await placeOrder("fake");
    await admin`select app.confirm_order_payment(${paymentId}, 'system', 'fake')`;
    const [r] = await admin<{ id: string }[]>`
      select app.request_refund(o, 5000, '[]'::jsonb, false, null, ${`reemb-${randomBytes(8).toString("hex")}`}) as id
        from public.orders o where o.id = ${orderId}`;
    await runJob("refund.succeeded", { order_id: orderId, refund_id: r!.id });
    expect(channel.sent).toHaveLength(0); // aún no confirmado
    await admin`select system.apply_refund_result(${r!.id}, 'succeeded', 'fake_r', null)`;
    await runJob("refund.succeeded", { order_id: orderId, refund_id: r!.id });
    await runJob("refund.succeeded", { order_id: orderId, refund_id: r!.id });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.subject).toContain("Reembolso de");
    await runJob("order.cancelled", { order_id: orderId });
    expect(channel.sent).toHaveLength(2);
  });

  describe("correo de confirmación: una sola vez y nunca a un correo que rebotó", () => {
    afterAll(async () => {
      await admin`delete from system.email_suppressions`;
    });

    it("lleva el método de pago y sale una sola vez aunque el aviso llegue dos veces", async () => {
      const { orderId, paymentId } = await placeOrder("fake");
      await admin`select app.confirm_order_payment(${paymentId}, 'system', 'fake')`;
      await runJob("order.paid", { order_id: orderId });
      await runJob("order.paid", { order_id: orderId });
      const buyer = channel.sent.filter((m) => m.to === "comprador@example.test");
      expect(buyer).toHaveLength(1);
      expect(buyer[0]!.text).toContain("Pagaste con: Prueba");
      expect(buyer[0]!.text).toContain("Sigue tu pedido:");
    });

    it("un correo suprimido (rebote o queja) no recibe nada y queda registrado", async () => {
      await admin`select system.email_suppress('Comprador@Example.test', 'complaint', 'provider_webhook', 'msg_x')`;
      const { orderId, paymentId } = await placeOrder("fake");
      await admin`select app.confirm_order_payment(${paymentId}, 'system', 'fake')`;
      await runJob("order.paid", { order_id: orderId });
      expect(channel.sent.filter((m) => m.to === "comprador@example.test")).toHaveLength(0);
      const [row] = await admin<{ status: string }[]>`
        select status from public.notification_deliveries
         where dedupe_key like ${`order.paid:${orderId}:order_confirmation:%`}`;
      expect(row!.status).toBe("suppressed");
      await admin`delete from system.email_suppressions`;
    });

    it("correo mal escrito: el rechazo definitivo lo suprime y no se reintenta", async () => {
      let attempts = 0;
      const bouncing: EmailChannel = {
        provider: "fake",
        async send(message) {
          if (message.to === "comprador@example.test") {
            attempts += 1;
            throw new PermanentDeliveryError("dirección inexistente");
          }
          return { providerMessageId: "ok" };
        },
      };
      const first = await placeOrder("fake");
      await admin`select app.confirm_order_payment(${first.paymentId}, 'system', 'fake')`;
      channel = bouncing as typeof channel;
      await runJob("order.paid", { order_id: first.orderId });
      const second = await placeOrder("fake");
      await admin`select app.confirm_order_payment(${second.paymentId}, 'system', 'fake')`;
      await runJob("order.paid", { order_id: second.orderId });
      expect(attempts).toBe(1);
      const [s] = await admin<{ reason: string; source: string }[]>`
        select reason, source from system.email_suppressions`;
      expect(s).toEqual({ reason: "bounce", source: "send_rejected" });
    });
  });
});
