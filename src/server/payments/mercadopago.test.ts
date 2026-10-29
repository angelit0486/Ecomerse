import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createMercadoPagoProvider,
  normalizeMercadoPagoPayment,
  pickPayment,
  toCents,
  toDecimal,
  verifyMercadoPagoSignature,
  type MercadoPagoPayment,
} from "./mercadopago";
import { ProviderHttpError } from "./provider";

const SECRET = "mpsecret0123456789abcdef";
const NOW = new Date("2026-10-17T12:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));
const account = {
  id: "acc",
  provider: "mercadopago" as const,
  mode: "test" as const,
  publicConfig: { mp_user_id: "4444" },
};

function sign(manifest: string, secret = SECRET) {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function header(dataId: string, requestId: string, ts = TS, secret = SECRET) {
  return `ts=${ts},v1=${sign(`id:${dataId};request-id:${requestId};ts:${ts};`, secret)}`;
}

describe("firma del webhook de Mercado Pago", () => {
  it("acepta la firma del manifiesto id;request-id;ts", () => {
    const r = verifyMercadoPagoSignature({
      secret: SECRET,
      header: header("123", "req-1"),
      requestId: "req-1",
      dataId: "123",
      now: NOW,
    });
    expect(r).toEqual({ ok: true, signedAt: new Date(Number(TS) * 1000) });
  });

  it("rechaza otra clave, otro data.id u otro request-id", () => {
    const base = { secret: SECRET, requestId: "req-1", dataId: "123", now: NOW };
    expect(
      verifyMercadoPagoSignature({
        ...base,
        header: header("123", "req-1", TS, "otra-clave-000000"),
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyMercadoPagoSignature({ ...base, header: header("999", "req-1") })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyMercadoPagoSignature({ ...base, header: header("123", "req-2") })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rechaza una firma vieja (replay) y acepta ts en milisegundos", () => {
    const old = String(Number(TS) - 600);
    expect(
      verifyMercadoPagoSignature({
        secret: SECRET,
        header: header("123", "r", old),
        requestId: "r",
        dataId: "123",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "stale" });
    const ms = String(NOW.getTime());
    expect(
      verifyMercadoPagoSignature({
        secret: SECRET,
        header: header("123", "r", ms),
        requestId: "r",
        dataId: "123",
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("cabeceras ausentes o mal formadas → malformed; un data.id alfanumérico va en minúsculas", () => {
    const base = { secret: SECRET, requestId: "r", dataId: "123", now: NOW };
    expect(verifyMercadoPagoSignature({ ...base, header: null }).ok).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, header: "ts=abc,v1=zz" })).toEqual({
      ok: false,
      reason: "malformed",
    });
    const h = `ts=${TS},v1=${sign(`id:abc9;request-id:r;ts:${TS};`)}`;
    expect(verifyMercadoPagoSignature({ ...base, dataId: "ABC9", header: h }).ok).toBe(true);
    // Sin x-request-id la parte se omite del manifiesto.
    const h2 = `ts=${TS},v1=${sign(`id:123;ts:${TS};`)}`;
    expect(verifyMercadoPagoSignature({ ...base, requestId: null, header: h2 }).ok).toBe(true);
  });
});

describe("montos y estados", () => {
  it("convierte centavos ↔ decimales sin perder precisión", () => {
    expect(toDecimal(89950)).toBe(899.5);
    expect(toDecimal(1)).toBe(0.01);
    expect(toCents(899.5)).toBe(89950);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(10.005)).toBe(-1);
    expect(toCents("899.5")).toBe(-1);
    expect(() => toDecimal(0)).toThrow();
    expect(() => toDecimal(1.5)).toThrow();
  });

  it("normaliza el cobro: aprobado, rechazado con motivo, pendiente (OXXO)", () => {
    const base: MercadoPagoPayment = {
      id: 555,
      status: "approved",
      transaction_amount: 1299,
      currency_id: "MXN",
      external_reference: "ref",
      payment_type_id: "credit_card",
      status_detail: "accredited",
    };
    expect(normalizeMercadoPagoPayment(base)).toEqual({
      providerPaymentId: "555",
      status: "succeeded",
      amount: 129900,
      currency: "MXN",
      externalReference: "ref",
      method: "credit_card",
    });
    expect(
      normalizeMercadoPagoPayment({
        ...base,
        status: "rejected",
        status_detail: "cc_rejected_other_reason",
      }),
    ).toMatchObject({ status: "failed", failureCode: "cc_rejected_other_reason" });
    expect(
      normalizeMercadoPagoPayment({ ...base, status: "pending", payment_type_id: "ticket" }).status,
    ).toBe("pending");
    expect(normalizeMercadoPagoPayment({ ...base, status: "in_process" }).status).toBe("pending");
    expect(normalizeMercadoPagoPayment({ ...base, status: "charged_back" }).status).toBe(
      "refunded",
    );
  });

  it("distingue contracargo de reembolso hecho en Mercado Pago (ADR-043)", () => {
    const base: MercadoPagoPayment = {
      id: 1,
      status: "approved",
      transaction_amount: 10,
      currency_id: "MXN",
      external_reference: "r",
    };
    expect(normalizeMercadoPagoPayment({ ...base, status: "charged_back" }).reversal).toBe(
      "chargeback",
    );
    expect(normalizeMercadoPagoPayment({ ...base, status: "refunded" }).reversal).toBe("refund");
    expect(normalizeMercadoPagoPayment(base).reversal).toBeUndefined();
  });

  it("de varios cobros de un intento manda el aprobado", () => {
    const p = (id: number, status: string): MercadoPagoPayment => ({
      id,
      status,
      transaction_amount: 1,
      currency_id: "MXN",
      external_reference: "r",
    });
    expect(pickPayment([p(3, "rejected"), p(2, "approved"), p(1, "rejected")])?.id).toBe(2);
    expect(pickPayment([p(3, "rejected"), p(1, "pending")])?.id).toBe(3);
    expect(pickPayment([])).toBeNull();
  });
});

describe("adaptador", () => {
  function provider(responder: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const p = createMercadoPagoProvider({
      accessToken: "TEST-0000000000000000-000000-token",
      webhookSecret: SECRET,
      apiBase: "https://mp.test",
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return responder(url, init);
      }) as unknown as typeof fetch,
    });
    return { p, calls };
  }

  const checkout = {
    account,
    payment: { id: "11111111-1111-4111-8111-111111111111", amount: 89950, currency: "MXN" },
    order: { id: "o-1", displayNumber: "#1001", items: [] },
    buyer: { email: "c@example.test", name: "Cliente" },
    returnUrls: {
      success: "https://tienda.mx/pedido/1",
      pending: "https://tienda.mx/pedido/1",
      failure: "https://tienda.mx/pedido/1",
    },
    expiresAt: new Date("2026-10-17T12:30:00Z"),
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
  };

  it("crea la preferencia por el total, con referencia, vencimiento e idempotencia", async () => {
    const { p, calls } = provider(
      () =>
        new Response(
          JSON.stringify({
            id: "4444-abcdef12",
            init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=x",
            sandbox_init_point: "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=x",
          }),
        ),
    );
    const r = await p.createCheckout(checkout);
    expect(r).toEqual({
      providerCheckoutId: "4444-abcdef12",
      redirectUrl: "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=x",
    });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://mp.test/checkout/preferences");
    expect((calls[0]!.init.headers as Record<string, string>)["x-idempotency-key"]).toBe(
      checkout.idempotencyKey,
    );
    expect(body.items).toEqual([
      { id: "o-1", title: "Pedido #1001", quantity: 1, unit_price: 899.5, currency_id: "MXN" },
    ]);
    expect(body).toMatchObject({
      external_reference: checkout.payment.id,
      auto_return: "approved",
      expires: true,
      expiration_date_to: "2026-10-17T12:30:00.000Z",
    });
  });

  it("nunca redirige fuera de Mercado Pago ni cobra otra moneda", async () => {
    const { p } = provider(
      () =>
        new Response(JSON.stringify({ id: "4444-abcdef12", init_point: "https://evil.example/x" })),
    );
    await expect(
      p.createCheckout({ ...checkout, account: { ...account, mode: "live" } }),
    ).rejects.toThrow();
    await expect(
      p.createCheckout({ ...checkout, payment: { ...checkout.payment, currency: "USD" } }),
    ).rejects.toThrow(/pesos/);
  });

  it("errores 4xx son rechazos definitivos; 5xx y 429 se reintentan", async () => {
    const { p } = provider(() => new Response("{}", { status: 400 }));
    const e = await p.createCheckout(checkout).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProviderHttpError);
    expect((e as ProviderHttpError).rejected).toBe(true);
    const { p: p5 } = provider(() => new Response("{}", { status: 503 }));
    expect(
      ((await p5.createCheckout(checkout).catch((x: unknown) => x)) as ProviderHttpError).rejected,
    ).toBe(false);
  });

  it("verifica el evento y expone el collector y el cobro", async () => {
    const { p } = provider(() => new Response("{}"));
    const rawBody = JSON.stringify({
      id: 987,
      type: "payment",
      action: "payment.updated",
      user_id: 4444,
      live_mode: false,
      data: { id: "123" },
    });
    const ok = await p.verifyWebhook({
      account,
      headers: new Headers({ "x-signature": header("123", "req"), "x-upstream-request-id": "req" }),
      rawBody,
      now: NOW,
    });
    expect(ok).toMatchObject({
      ok: true,
      eventId: "987",
      type: "payment.updated",
      account: "4444",
      providerPaymentId: "123",
      livemode: false,
    });
    const bad = await p.verifyWebhook({
      account,
      headers: new Headers({ "x-signature": header("124", "req"), "x-upstream-request-id": "req" }),
      rawBody,
      now: NOW,
    });
    expect(bad).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("reembolso: crea con idempotencia y luego consulta por su id", async () => {
    const { p, calls } = provider((url) =>
      url.endsWith("/refunds")
        ? new Response(JSON.stringify({ id: 77, status: "in_process" }))
        : new Response(JSON.stringify({ id: 77, status: "approved" })),
    );
    const base = { account, providerPaymentId: "555", amount: 50000, idempotencyKey: "rid" };
    expect(await p.refund(base)).toEqual({ providerRefundId: "77", status: "pending" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ amount: 500 });
    expect(await p.refund({ ...base, providerRefundId: "77" })).toEqual({
      providerRefundId: "77",
      status: "succeeded",
    });
    expect(calls[1]!.url).toBe("https://mp.test/v1/payments/555/refunds/77");
  });
});
