import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * ADR-044: la dueña paga su plan con tarjeta en Stripe Checkout (simulado aquí en
 * :4599; la app arranca con STRIPE_API_BASE apuntando a él) y el plan se activa
 * solo con el webhook firmado.
 */
const run = uniq();
const email = `tarjeta-${run}@example.test`;
const planKey = `tc_${run.replace(/[^a-z0-9]/g, "")}`.slice(0, 30);
const WEBHOOK_SECRET = "whsec_0000000000";
let tenant: Awaited<ReturnType<typeof createTenant>>;
let server: Server;
const planKey2 = `${planKey}b`;
const checkoutBodies: URLSearchParams[] = [];
const changeBodies: URLSearchParams[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (value: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      // Cambio de plan (ADR-044): leer el concepto, crear el producto y actualizar.
      if (req.method === "GET" && req.url?.startsWith("/v1/subscriptions/sub_")) {
        return json({ id: req.url.split("/").at(-1), items: { data: [{ id: "si_test123" }] } });
      }
      if (req.method === "POST" && req.url === "/v1/products") return json({ id: "prod_test123" });
      if (req.method === "POST" && req.url?.startsWith("/v1/subscriptions/sub_")) {
        changeBodies.push(new URLSearchParams(body));
        return json({ id: req.url.split("/").at(-1) });
      }
      if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
        checkoutBodies.push(new URLSearchParams(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "cs_test_1", url: "http://127.0.0.1:4599/pagar" }));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html lang='es'><title>Stripe simulado</title><h1>Stripe simulado</h1></html>",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(4599, "127.0.0.1", resolve));
  tenant = await createTenant(`tc${run}`, await createAuthUser(email));
  await admin`insert into public.plans (key, name, status, sort, price_monthly, price_annual)
              values (${planKey}, ${`Tarjeta ${run}`}, 'active', 98, 49900, 479000)`;
  const [p2] = await admin<{ id: string }[]>`
    insert into public.plans (key, name, status, sort, price_monthly, price_annual)
    values (${planKey2}, ${`Crece ${run}`}, 'active', 99, 99900, null) returning id`;
  await admin`insert into public.plan_entitlements (plan_id, key, value_int)
              values (${p2!.id}, 'max_stores', 5), (${p2!.id}, 'max_products', 1000), (${p2!.id}, 'max_staff', 10)`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function signed(body: string) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
  return { "stripe-signature": `t=${t},v1=${v1}`, "content-type": "application/json" };
}

test("pagar el plan con tarjeta: Stripe Checkout y activación por webhook firmado", async ({
  page,
}) => {
  await loginNewStaff(page, email);
  await page.goto(`/admin/${tenant.handle}/ajustes/plan`);
  const section = page.getByRole("region", { name: "Pagar con tarjeta" });
  await expect(section).toBeVisible();
  await section.getByLabel(new RegExp(`Tarjeta ${run} · \\$4,790\\.00 al año`)).check();
  await expectNoSeriousA11yViolations(page);
  await section.getByRole("button", { name: "Pagar con tarjeta" }).click();
  await expect(page.getByRole("heading", { name: "Stripe simulado" })).toBeVisible();

  // Stripe recibió el precio de la base, no uno del navegador.
  const body = checkoutBodies.at(-1)!;
  expect(body.get("mode")).toBe("subscription");
  expect(body.get("line_items[0][price_data][unit_amount]")).toBe("479000");
  expect(body.get("line_items[0][price_data][recurring][interval]")).toBe("year");
  const orgId = body.get("subscription_data[metadata][organization_id]")!;
  const [org] = await admin<{ organization_id: string }[]>`
    select organization_id from public.stores where id = ${tenant.storeId}`;
  expect(orgId).toBe(org!.organization_id);

  // Sin firma no pasa nada.
  const event = JSON.stringify({
    id: `evt_${run}1`,
    type: "customer.subscription.created",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: `sub_${run}1`,
        customer: `cus_${run}1`,
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 31_536_000,
        metadata: { organization_id: orgId, plan_key: planKey, interval: "annual" },
      },
    },
  });
  const forged = await page.request.post("/api/webhooks/billing/stripe", {
    data: event,
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
  });
  expect(forged.status()).toBe(401);

  const ok = await page.request.post("/api/webhooks/billing/stripe", {
    data: event,
    headers: signed(event),
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ received: true, outcome: "updated" });

  await page.goto(`/admin/${tenant.handle}/ajustes/plan?pago=listo`);
  await expect(page.getByRole("status").filter({ hasText: "Recibimos tu pago" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: `Tarjeta ${run}` })).toBeVisible();
  // Ya paga con Stripe: no se ofrece abrir otra suscripción.
  await expect(page.getByRole("region", { name: "Pagar con tarjeta" })).toHaveCount(0);
  const [sub] = await admin<{ status: string; provider: string; billing_interval: string }[]>`
    select status, provider, billing_interval from public.subscriptions
     where organization_id = ${orgId} and status <> 'cancelled'`;
  expect(sub).toEqual({ status: "active", provider: "stripe", billing_interval: "annual" });
  await expectNoSeriousA11yViolations(page);

  // ADR-044, prorrateo: cambiar a otro plan desde la misma página.
  const change = page.getByRole("region", { name: "Cambiar plan" });
  await expect(change).toBeVisible();
  await expect(change.getByLabel(/\(tu plan actual\)/)).toBeDisabled();
  await change.getByLabel(new RegExp(`Crece ${run} · \\$999\\.00 al mes`)).check();
  await change.getByRole("button", { name: "Cambiar plan" }).click();
  await expect(change.getByRole("status")).toContainText("Pedimos el cambio a Stripe");
  const changed = changeBodies.at(-1)!;
  expect(changed.get("items[0][id]")).toBe("si_test123");
  expect(changed.get("items[0][price_data][unit_amount]")).toBe("99900");
  expect(changed.get("items[0][price_data][recurring][interval]")).toBe("month");
  expect(changed.get("proration_behavior")).toBe("create_prorations");
  expect(changed.get("metadata[plan_key]")).toBe(planKey2);
  await expectNoSeriousA11yViolations(page);

  // El plan cambia aquí solo con el webhook firmado.
  const updated = JSON.stringify({
    id: `evt_${run}2`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000) + 1,
    livemode: false,
    data: {
      object: {
        id: `sub_${run}1`,
        customer: `cus_${run}1`,
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        metadata: { organization_id: orgId, plan_key: planKey2, interval: "monthly" },
      },
    },
  });
  const applied = await page.request.post("/api/webhooks/billing/stripe", {
    data: updated,
    headers: signed(updated),
  });
  expect(await applied.json()).toMatchObject({ received: true, outcome: "updated" });
  await page.reload();
  await expect(page.getByRole("definition").filter({ hasText: `Crece ${run}` })).toBeVisible();
});
