import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Handlers from "./handlers";

const mocks = vi.hoisted(() => ({
  sent: [] as { template: string; subject: string; text: string }[],
  storeText: null as { subject: string | null; note: string | null } | null,
}));

vi.mock("./handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof Handlers>();
  return {
    ...actual,
    alreadyDelivered: () => Promise.resolve(false),
    sendNotification: (
      _deps: unknown,
      input: { template: string; message: { subject: string; text: string } },
    ) => {
      mocks.sent.push({
        template: input.template,
        subject: input.message.subject,
        text: input.message.text,
      });
      return Promise.resolve();
    },
  };
});
vi.mock("./store-texts-db", () => ({
  fetchStoreText: () => Promise.resolve(mocks.storeText),
}));

import type { Sql } from "@/server/db/role-clients";
import type { JobContext, JobHandler, JobRecord } from "@/server/jobs/types";

import { createOrderNotificationHandlers } from "./order-handlers";

const STORE = "0191f3a0-0000-7000-8000-000000000001";
const ORDER = "0191f3a0-0000-7000-8000-000000000002";
const SHIPMENT = "0191f3a0-0000-7000-8000-000000000003";

function notification(shippingType: string) {
  return {
    store: {
      id: STORE,
      handle: "tienda",
      name: "Tienda",
      locale: "es-MX",
      currency: "MXN",
      contact_email: null,
      organization_id: "org",
      hostname: null,
      logo_path: null,
      primary_color: null,
    },
    order: {
      id: ORDER,
      email: "c@x.test",
      status: "paid",
      payment_status: "paid",
      checkout_idempotency_key: null,
      display_number: "#1001",
      customer_name: "Ana",
      subtotal: 10000,
      discount_total: 0,
      shipping_total: 0,
      tax_total: 0,
      total: 10000,
      prices_include_tax: true,
      shipping_name: "Recoger en tienda",
      shipping_type: shippingType,
      pickup: shippingType === "pickup" ? { address: "Av. Juárez 10", hours: null } : null,
    },
    items: [],
    payment: null,
    shipment: { carrier: null, tracking_number: null, tracking_url: null },
    refund: null,
    staff: { emails: [], notify_new_order: false, notify_paid: false },
  };
}

function handlersFor(shippingType: string): Map<string, JobHandler> {
  const db = (() => Promise.resolve([{ value: notification(shippingType) }])) as unknown as Sql;
  return new Map(
    createOrderNotificationHandlers({
      db,
      channel: { send: vi.fn() } as never,
      linkSecret: "secret-secret-secret-secret-secret",
      storeOrigin: (h) => `https://${h}`,
      mediaUrl: (p) => `https://media.test/${p}`,
      appUrl: "https://panel.test",
    }),
  );
}

const job = (type: string): JobRecord => ({
  id: "j1",
  type,
  storeId: STORE,
  payload: { order_id: ORDER, shipment_id: SHIPMENT },
  attempts: 0,
  maxAttempts: 3,
});
const ctx = { log: { info: vi.fn() } } as unknown as JobContext;

beforeEach(() => {
  mocks.sent = [];
  mocks.storeText = null;
});

describe("asunto propio de la tienda en «Recoger en tienda»", () => {
  it("retiro: se ignora el asunto «va en camino» de la tienda; su mensaje sí va", async () => {
    mocks.storeText = { subject: "¡{pedido} va en camino!", note: "Gracias por elegirnos" };
    const h = handlersFor("pickup");
    await h.get("order.shipped")!(job("order.shipped"), ctx);
    await h.get("order.delivered")!(job("order.delivered"), ctx);
    expect(mocks.sent.map((m) => m.subject)).toEqual([
      "Tu pedido #1001 está listo para recoger",
      "Tu pedido #1001 ya fue recogido",
    ]);
    for (const m of mocks.sent) expect(m.text).toContain("Gracias por elegirnos");
  });

  it("envío normal: el asunto de la tienda se respeta como siempre", async () => {
    mocks.storeText = { subject: "¡{pedido} va en camino!", note: null };
    const h = handlersFor("flat");
    await h.get("order.shipped")!(job("order.shipped"), ctx);
    expect(mocks.sent.map((m) => m.subject)).toEqual(["¡#1001 va en camino!"]);
  });
});
