import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/observability/logger";
import { sqlRecorder } from "../../../tests/support/sql-recorder";

import type { MercadoPagoProvider } from "./mercadopago";
import { handleMercadoPagoWebhook } from "./mercadopago-webhook";

/**
 * Cableado webhook → correo: el correo de pago confirmado («order.paid») solo lo
 * encola la base dentro de system.apply_mercadopago_payment. Estas pruebas fijan que
 * esa función solo se llama con un aviso verificado, nuevo y re-consultado.
 */
const log = createLogger({ level: "error" });
const ACCOUNT = { id: "acc", store_id: "store", status: "active", mode: "test" };
const PAYMENT_ID = "0190a000-0000-7000-8000-000000000001";

function provider(verify: Awaited<ReturnType<MercadoPagoProvider["verifyWebhook"]>>) {
  return {
    verifyWebhook: vi.fn(async () => verify),
    fetchPayment: vi.fn(async () => ({
      status: "approved",
      amount: 1000n,
      currency: "MXN",
      providerPaymentId: "123",
      externalReference: PAYMENT_ID,
      collectorId: "999",
    })),
  } as unknown as MercadoPagoProvider;
}

function db(processed = false) {
  return sqlRecorder((q) => {
    if (q.includes("payment_account_for_webhook")) return [ACCOUNT];
    if (q.includes("record_payment_event")) return [{ r: { id: "ev", processed } }];
    if (q.includes("payment_for_provider_ref")) return [{ p: { id: PAYMENT_ID } }];
    if (q.includes("apply_mercadopago_payment")) return [{ r: { outcome: "applied" } }];
    return [];
  });
}

const verified = {
  ok: true as const,
  eventId: "e1",
  type: "payment.updated",
  signedAt: new Date(),
  livemode: false,
  account: "999",
  providerPaymentId: "123",
};

function run(p: MercadoPagoProvider, d: ReturnType<typeof db>, url = "https://x.test/hook") {
  return handleMercadoPagoWebhook({
    db: d.db,
    provider: p,
    url: new URL(url),
    headers: new Headers(),
    rawBody: '{"type":"payment","data":{"id":"123"}}',
    now: new Date(),
    log,
  });
}

const applied = (d: ReturnType<typeof db>) =>
  d.queries.filter((q) => q.includes("apply_mercadopago_payment")).length;

describe("webhook de Mercado Pago → correo de pago confirmado", () => {
  it("firma inválida: 401 y nunca aplica el cobro (no hay correo)", async () => {
    const d = db();
    const res = await run(provider({ ok: false, reason: "bad_signature" }), d);
    expect(res.status).toBe(401);
    expect(applied(d)).toBe(0);
  });

  it("data.id de la URL distinto del firmado: 400 y no aplica", async () => {
    const d = db();
    const res = await run(provider(verified), d, "https://x.test/hook?data.id=124");
    expect(res.status).toBe(400);
    expect(applied(d)).toBe(0);
  });

  it("aviso verificado: re-consulta el cobro y aplica una sola vez", async () => {
    const d = db();
    const p = provider(verified);
    const res = await run(p, d);
    expect(res.status).toBe(200);
    expect(p.fetchPayment).toHaveBeenCalledTimes(1);
    expect(applied(d)).toBe(1);
  });

  it("aviso repetido (mismo evento ya procesado): 200 'duplicate' sin aplicar otra vez", async () => {
    const d = db(true);
    const res = await run(provider(verified), d);
    expect(res.body).toMatchObject({ outcome: "duplicate" });
    expect(applied(d)).toBe(0);
  });

  it("cobro de otra cuenta (collector distinto): no aplica", async () => {
    const d = db();
    const res = await run(provider({ ...verified, account: "111" }), d);
    expect(res.body).toMatchObject({ outcome: "unknown_payment" });
    expect(applied(d)).toBe(0);
  });
});
