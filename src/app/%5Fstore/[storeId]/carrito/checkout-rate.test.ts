import { beforeEach, describe, expect, it, vi } from "vitest";

const setCartDetails = vi.fn();
const placeOrder = vi.fn();
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/jobs/run-now", () => ({ processQueueSoon: vi.fn() }));
vi.mock("@/server/actions/report", () => ({ reportActionError: (_: string, e: unknown) => e }));
vi.mock("@/server/env", () => ({ serverEnv: () => ({ APP_ENV: "test" }) }));
vi.mock("@/server/payments/order-links", () => ({
  isGuestTokenShape: vi.fn(),
  verifyFakePaymentSignature: vi.fn(),
}));
vi.mock("@/server/storefront/cart", () => ({
  addToCart: vi.fn(),
  dbDetail: vi.fn(),
  discountGuard: vi.fn(),
  getCart: vi.fn(),
  setCartDetails: (...args: unknown[]) => setCartDetails(...args),
  setCartQuantity: vi.fn(),
}));
vi.mock("@/server/storefront/checkout", () => ({
  fakePaymentResult: vi.fn(),
  placeOrder: (...args: unknown[]) => placeOrder(...args),
  retryPayment: vi.fn(),
}));
vi.mock("@/server/storefront/context", () => ({
  getStorefront: async () => ({ store: { id: "store-1", currency: "MXN", locale: "es-MX" } }),
}));
vi.mock("@/server/storefront/flags", () => ({ storeFlags: async () => new Set() }));

import { checkout } from "./actions";

const RATE = "0190a7e2-1c3d-7a4b-8c5d-6e7f80910a1b";

function form(intent: string): FormData {
  const f = new FormData();
  f.set("intent", intent);
  f.set("email", "ana@example.io");
  f.set("requires_shipping", "1");
  for (const [k, v] of Object.entries({
    line1: "Calle 1",
    city: "Puebla",
    region: "Puebla",
    postal_code: "72000",
    country: "MX",
  }))
    f.set(k, v);
  f.set("shipping_rate_id", RATE);
  f.set("expected_total", "59800");
  return f;
}

describe("checkout: cambiar la forma de envío actualiza el total al momento", () => {
  beforeEach(() => {
    setCartDetails.mockReset().mockResolvedValue({ shipping: { status: "ok" } });
    placeOrder.mockReset();
    refresh.mockReset();
  });

  it("«rate» guarda la tarifa elegida y vuelve a pintar el checkout, sin crear el pedido", async () => {
    const r = await checkout("store-1", {}, form("rate"));
    expect(setCartDetails).toHaveBeenCalledOnce();
    expect(setCartDetails.mock.calls[0]![1]).toMatchObject({ shipping_rate_id: RATE });
    expect(refresh).toHaveBeenCalledOnce();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: "Total actualizado con la forma de envío elegida." });
  });

  it("una intención desconocida se trata como cotizar, nunca como confirmar", async () => {
    const r = await checkout("store-1", {}, form("otra"));
    expect(placeOrder).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: "Formas de envío actualizadas." });
  });
});
