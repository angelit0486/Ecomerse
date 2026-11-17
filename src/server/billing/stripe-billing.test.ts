import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { StripeApi } from "@/server/payments/stripe";

import {
  changeSubscriptionPlan,
  checkoutInputSchema,
  createSubscriptionCheckout,
  parseBillingWebhook,
} from "./stripe-billing";

/**
 * Stripe Billing (ADR-044) con payloads y firmas de ejemplo. La prueba contra el
 * sandbox real queda pendiente de la cuenta Stripe del propietario.
 */
const SECRET = "whsec_billingsecret00000000";
const ORG = "0190a0d0-0000-7000-8000-0000000000aa";
const NOW = new Date("2026-10-29T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);

function sign(body: string, t = T, secret = SECRET) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function event(type: string, object: Record<string, unknown>, livemode = false) {
  return JSON.stringify({ id: "evt_123abc", type, created: T, livemode, data: { object } });
}

const subscription = {
  id: "sub_123abc",
  customer: "cus_123abc",
  status: "active",
  current_period_end: T + 2592000,
  metadata: { organization_id: ORG, plan_key: "basico", interval: "annual" },
};

const parse = (
  rawBody: string,
  signature: string | null = sign(rawBody),
  requireLivemode = false,
) => parseBillingWebhook({ secret: SECRET, signature, rawBody, now: NOW, requireLivemode });

describe("webhook de Stripe Billing", () => {
  it("traduce una suscripción firmada al evento que aplica la base", () => {
    const body = event("customer.subscription.updated", subscription);
    expect(parse(body)).toEqual({
      kind: "event",
      event: {
        event_id: "evt_123abc",
        created: T,
        type: "customer.subscription.updated",
        organization_id: ORG,
        customer_id: "cus_123abc",
        subscription_id: "sub_123abc",
        status: "active",
        plan_key: "basico",
        interval: "annual",
        current_period_end: T + 2592000,
      },
    });
  });

  it("sin firma, con firma de otro secreto o vieja: se rechaza", () => {
    const body = event("customer.subscription.updated", subscription);
    expect(parse(body, null)).toMatchObject({ kind: "rejected", status: 401, reason: "malformed" });
    expect(parse(body, sign(body, T, "whsec_otrosecreto000000000"))).toMatchObject({
      kind: "rejected",
      reason: "bad_signature",
    });
    expect(parse(body, sign(body, T - 3600))).toMatchObject({ kind: "rejected", reason: "stale" });
  });

  it("borrada = cancelada aunque el objeto diga otro estado", () => {
    const body = event("customer.subscription.deleted", { ...subscription, status: "active" });
    expect(parse(body)).toMatchObject({ kind: "event", event: { status: "canceled" } });
  });

  it("facturas, eventos sin nuestros metadatos y modo prueba en producción se ignoran", () => {
    expect(parse(event("invoice.paid", { id: "in_1" }))).toEqual({
      kind: "ignored",
      reason: "type",
    });
    const foreign = event("customer.subscription.updated", { ...subscription, metadata: {} });
    expect(parse(foreign)).toEqual({ kind: "ignored", reason: "not_ours" });
    const test = event("customer.subscription.updated", subscription, false);
    expect(parse(test, sign(test), true)).toEqual({ kind: "ignored", reason: "test_mode" });
  });

  it("sin intervalo en los metadatos se toma mensual", () => {
    const body = event("customer.subscription.created", {
      ...subscription,
      metadata: { organization_id: ORG, plan_key: "basico" },
    });
    expect(parse(body)).toMatchObject({ kind: "event", event: { interval: "monthly" } });
  });
});

describe("Checkout de la suscripción", () => {
  it("manda el precio de la base, el intervalo y los metadatos, con idempotencia", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ url: "https://checkout.stripe.test/s/1" }));
    const api = new StripeApi({ secretKey: "sk_test_x", webhookSecret: SECRET, fetchImpl });
    const url = await createSubscriptionCheckout(api, {
      organization_id: ORG,
      plan_key: "basico",
      plan_name: "Básico",
      interval: "annual",
      amount: 479000,
      currency: "MXN",
      customer_id: null,
      email: "duena@tienda.test",
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/no",
    });
    expect(url).toBe("https://checkout.stripe.test/s/1");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("479000");
    expect(body.get("line_items[0][price_data][currency]")).toBe("mxn");
    expect(body.get("line_items[0][price_data][recurring][interval]")).toBe("year");
    expect(body.get("subscription_data[metadata][organization_id]")).toBe(ORG);
    expect(body.get("customer_email")).toBe("duena@tienda.test");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(
      new RegExp(`^billing:${ORG}:basico:annual:\\d+$`),
    );
    // La cuenta de la plataforma cobra: nunca la cabecera de una cuenta conectada.
    expect((init.headers as Record<string, string>)["stripe-account"]).toBeUndefined();
    // Sin cuota de arranque ni IVA configurado: una sola partida, sin impuestos.
    expect(body.get("line_items[1][price_data][unit_amount]")).toBeNull();
    expect(body.get("line_items[0][tax_rates][0]")).toBeNull();
  });

  it("ADR-068: la cuota de arranque va como pago único y el IVA en ambas partidas", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ url: "https://checkout.stripe.test/s/2" }));
    const api = new StripeApi({ secretKey: "sk_test_x", webhookSecret: SECRET, fetchImpl });
    await createSubscriptionCheckout(api, {
      organization_id: ORG,
      plan_key: "tienda",
      plan_name: "Tienda",
      interval: "monthly",
      amount: 69900,
      currency: "MXN",
      customer_id: null,
      setup_fee: 290000,
      email: null,
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/no",
      taxRateId: "txr_IVA16mx",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("69900");
    expect(body.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(body.get("line_items[1][price_data][unit_amount]")).toBe("290000");
    expect(body.get("line_items[1][price_data][currency]")).toBe("mxn");
    // Pago único: sin `recurring`, Stripe lo cobra solo en la primera factura.
    expect(body.get("line_items[1][price_data][recurring][interval]")).toBeNull();
    expect(body.get("line_items[1][price_data][product_data][name]")).toBe(
      "PRUVA · cuota de arranque (plan Tienda)",
    );
    expect(body.get("line_items[0][tax_rates][0]")).toBe("txr_IVA16mx");
    expect(body.get("line_items[1][tax_rates][0]")).toBe("txr_IVA16mx");
  });

  it("una cuota en 0 (ya pagada o saldada) no agrega partida", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ url: "https://checkout.stripe.test/s/3" }));
    const api = new StripeApi({ secretKey: "sk_test_x", webhookSecret: SECRET, fetchImpl });
    await createSubscriptionCheckout(api, {
      organization_id: ORG,
      plan_key: "tienda",
      plan_name: "Tienda",
      interval: "annual",
      amount: 699000,
      currency: "MXN",
      customer_id: "cus_123abc",
      setup_fee: 0,
      email: null,
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/no",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("line_items[1][price_data][unit_amount]")).toBeNull();
    expect(body.get("customer")).toBe("cus_123abc");
  });

  it("la respuesta de una base sin cuota (código anterior) se lee como cuota 0", () => {
    const parsed = checkoutInputSchema.parse({
      organization_id: ORG,
      plan_key: "tienda",
      plan_name: "Tienda",
      interval: "monthly",
      amount: 69900,
      currency: "MXN",
      customer_id: null,
    });
    expect(parsed.setup_fee).toBe(0);
    expect(() => checkoutInputSchema.parse({ ...parsed, setup_fee: -1 })).toThrow();
  });
});

describe("Cambio de plan con prorrateo", () => {
  it("cambia el precio del mismo concepto con prorrateo y metadatos nuevos", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/products")) return Response.json({ id: "prod_N1abc" });
      if (url.endsWith("/v1/subscriptions/sub_ABC") && fetchImpl.mock.calls.length === 1) {
        return Response.json({ id: "sub_ABC", items: { data: [{ id: "si_OLDx" }] } });
      }
      return Response.json({ id: "sub_ABC" });
    });
    const api = new StripeApi({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      fetchImpl: fetchImpl as never,
    });
    await changeSubscriptionPlan(api, {
      organization_id: ORG,
      subscription_id: "sub_ABC",
      plan_key: "pro",
      plan_name: "Pro",
      interval: "annual",
      amount: 959000,
      currency: "MXN",
      taxRateId: "txr_IVA16mx",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [getUrl, getInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(getUrl).toMatch(/\/v1\/subscriptions\/sub_ABC$/);
    expect(getInit.method).toBe("GET");
    const [, init] = fetchImpl.mock.calls[2] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("items[0][id]")).toBe("si_OLDx");
    expect(body.get("items[0][price_data][unit_amount]")).toBe("959000");
    expect(body.get("items[0][price_data][recurring][interval]")).toBe("year");
    expect(body.get("items[0][price_data][product]")).toBe("prod_N1abc");
    expect(body.get("proration_behavior")).toBe("create_prorations");
    expect(body.get("items[0][tax_rates][0]")).toBe("txr_IVA16mx");
    expect(body.get("metadata[plan_key]")).toBe("pro");
    expect(body.get("metadata[interval]")).toBe("annual");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(
      new RegExp(`^billing-change:${ORG}:pro:annual:\\d+$`),
    );
    expect((init.headers as Record<string, string>)["stripe-account"]).toBeUndefined();
  });

  it("sin el concepto de la suscripción no manda nada", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "sub_ABC", items: { data: [] } }));
    const api = new StripeApi({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      fetchImpl: fetchImpl as never,
    });
    await expect(
      changeSubscriptionPlan(api, {
        organization_id: ORG,
        subscription_id: "sub_ABC",
        plan_key: "pro",
        plan_name: "Pro",
        interval: "monthly",
        amount: 99900,
        currency: "MXN",
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
