import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { CreateCheckoutInput } from "./provider";
import {
  createStripeProvider,
  encodeForm,
  normalizeSession,
  verifyStripeSignature,
} from "./stripe";

/**
 * Pruebas de contrato del adaptador Stripe (F7-T01) con payloads y firmas de
 * ejemplo; la verificación contra el sandbox real queda pendiente (D-F7-02).
 */
const SECRET = "whsec_testsecret0000000000";
const ACCOUNT = "acct_1TestAccount000";
const PAYMENT = "0190a0d0-0000-7000-8000-000000000001";

function sign(body: string, t: number, secret = SECRET) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input: CreateCheckoutInput = {
  account: {
    id: "a",
    provider: "stripe",
    mode: "test",
    publicConfig: { stripe_account_id: ACCOUNT },
  },
  payment: { id: PAYMENT, amount: 54900, currency: "MXN" },
  order: { id: "0190a0d0-0000-7000-8000-00000000000a", displayNumber: "#1001", items: [] },
  buyer: { email: "ana@example.test" },
  returnUrls: {
    success: "https://tienda.example.com/pedido/x?t=y",
    pending: "https://tienda.example.com/pedido/x?t=y",
    failure: "https://tienda.example.com/pedido/x?t=y",
  },
  expiresAt: new Date(Date.now() + 28 * 60 * 1000),
  idempotencyKey: PAYMENT,
};

describe("codificación de formularios de Stripe", () => {
  it("objetos y arreglos anidados", () => {
    expect(
      encodeForm({ a: 1, b: { c: "x y" }, l: [{ q: 1 }], e: ["payment_intent"], skip: undefined }),
    ).toEqual(["a=1", "b%5Bc%5D=x%20y", "l%5B0%5D%5Bq%5D=1", "e%5B0%5D=payment_intent"]);
  });
});

describe("firma del webhook (Stripe-Signature)", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = new Date(1_800_000_000_000);
  const t = 1_800_000_000;

  it("válida dentro de la tolerancia", () => {
    expect(
      verifyStripeSignature({ secret: SECRET, header: sign(body, t), rawBody: body, now }),
    ).toMatchObject({
      ok: true,
    });
  });
  it("otro secreto o cuerpo alterado → bad_signature", () => {
    expect(
      verifyStripeSignature({
        secret: SECRET,
        header: sign(body, t, "whsec_otro0000000000"),
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      verifyStripeSignature({ secret: SECRET, header: sign(body, t), rawBody: `${body} `, now }),
    ).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
  it("marca de tiempo vencida (>5 min) → stale; replay con firma válida rechazado", () => {
    expect(
      verifyStripeSignature({ secret: SECRET, header: sign(body, t - 301), rawBody: body, now }),
    ).toEqual({
      ok: false,
      reason: "stale",
    });
  });
  it("cabecera ausente o mal formada → malformed", () => {
    expect(verifyStripeSignature({ secret: SECRET, header: null, rawBody: body, now })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(
      verifyStripeSignature({ secret: SECRET, header: "t=abc,v1=", rawBody: body, now }),
    ).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
  it("acepta una de varias firmas v1 (rotación de secretos)", () => {
    const good = sign(body, t).split(",")[1];
    expect(
      verifyStripeSignature({
        secret: SECRET,
        header: `t=${t},v1=${"0".repeat(64)},${good}`,
        rawBody: body,
        now,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("estado normalizado de la sesión", () => {
  const base = {
    id: "cs_test_000000001",
    url: null,
    amount_total: 54900,
    currency: "mxn",
    client_reference_id: PAYMENT,
    payment_method_types: ["card"],
  };
  it.each([
    [{ status: "complete", payment_status: "paid", payment_intent: "pi_1" }, "succeeded"],
    [{ status: "open", payment_status: "unpaid", payment_intent: null }, "pending"],
    [{ status: "expired", payment_status: "unpaid", payment_intent: null }, "expired"],
    [
      {
        status: "complete",
        payment_status: "unpaid",
        payment_intent: {
          id: "pi_2",
          status: "requires_payment_method",
          last_payment_error: { code: "card_declined" },
        },
      },
      "failed",
    ],
    [
      {
        status: "open",
        payment_status: "unpaid",
        payment_intent: { id: "pi_3", status: "canceled" },
      },
      "cancelled",
    ],
  ] as const)("%o → %s", (session, status) => {
    const n = normalizeSession({ ...base, ...session } as never);
    expect(n.status).toBe(status);
    expect(n).toMatchObject({ amount: 54900, currency: "MXN", externalReference: PAYMENT });
  });
});

describe("adaptador Stripe Connect", () => {
  it("createCheckout: cargo directo en la cuenta de la tienda, total exacto, idempotente y ≥ 30 min", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ id: "cs_test_000000001", url: "https://checkout.stripe.com/c/pay/x" }),
    );
    const provider = createStripeProvider({
      secretKey: "sk_test_0000000000",
      webhookSecret: SECRET,
      apiBase: "https://stripe.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const before = Math.floor(Date.now() / 1000);
    const r = await provider.createCheckout(input);
    expect(r).toEqual({
      providerCheckoutId: "cs_test_000000001",
      redirectUrl: "https://checkout.stripe.com/c/pay/x",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://stripe.test/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers["stripe-account"]).toBe(ACCOUNT);
    expect(headers["idempotency-key"]).toBe(PAYMENT);
    expect(headers.authorization).toBe("Bearer sk_test_0000000000");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_reference_id")).toBe(PAYMENT);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("54900");
    expect(body.get("line_items[0][price_data][currency]")).toBe("mxn");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(Number(body.get("expires_at"))).toBeGreaterThanOrEqual(before + 31 * 60);
  });

  it("sin cuenta conectada válida no llama al proveedor", async () => {
    const fetchImpl = vi.fn();
    const provider = createStripeProvider({
      secretKey: "sk_test_0000000000",
      webhookSecret: SECRET,
      fetchImpl,
    });
    await expect(
      provider.createCheckout({
        ...input,
        account: { ...input.account, publicConfig: { stripe_account_id: "x" } },
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un error del proveedor no filtra su respuesta", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { message: "secreto interno" } }, 402));
    const provider = createStripeProvider({
      secretKey: "sk_test_0000000000",
      webhookSecret: SECRET,
      fetchImpl,
    });
    await expect(provider.createCheckout(input)).rejects.toMatchObject({
      code: "provider_error",
      message: expect.not.stringContaining("secreto"),
    });
  });

  it("verifyWebhook extrae evento, cuenta, sesión y referencia", async () => {
    const provider = createStripeProvider({
      secretKey: "sk_test_0000000000",
      webhookSecret: SECRET,
    });
    const body = JSON.stringify({
      id: "evt_123",
      type: "checkout.session.completed",
      account: ACCOUNT,
      data: {
        object: {
          id: "cs_test_000000001",
          object: "checkout.session",
          client_reference_id: PAYMENT,
        },
      },
    });
    const now = new Date();
    const headers = new Headers({
      "stripe-signature": sign(body, Math.floor(now.getTime() / 1000)),
    });
    expect(
      await provider.verifyWebhook({ account: input.account, headers, rawBody: body, now }),
    ).toMatchObject({
      ok: true,
      eventId: "evt_123",
      account: ACCOUNT,
      checkoutId: "cs_test_000000001",
      reference: PAYMENT,
    });
  });

  it("refund: por el payment intent en la cuenta de la tienda, con clave de idempotencia", async () => {
    const fetchImpl = vi.fn(async () => json({ id: "re_1", status: "succeeded" }));
    const provider = createStripeProvider({
      secretKey: "sk_test_0000000000",
      webhookSecret: SECRET,
      fetchImpl,
    });
    const r = await provider.refund({
      account: input.account,
      providerPaymentId: "pi_1",
      amount: 1000,
      idempotencyKey: "rf_1",
    });
    expect(r).toEqual({ providerRefundId: "re_1", status: "succeeded" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("rf_1");
    expect(String(init.body)).toBe("payment_intent=pi_1&amount=1000");
  });
});
