import { describe, expect, it } from "vitest";

import { buyerStatus, visibleStatus } from "./visible-status";

const o = (
  status: string,
  payment_status: string,
  fulfillment_status = "unfulfilled",
  needs_attention = false,
) => ({
  status,
  payment_status,
  fulfillment_status,
  needs_attention,
});

describe("estado visible del pedido (§16.4)", () => {
  it.each([
    [o("pending_payment", "unpaid"), "Pendiente de pago"],
    [o("pending_payment", "failed"), "Pendiente de pago"],
    [o("open", "paid"), "Pagado — por preparar"],
    [o("open", "paid", "partially_fulfilled"), "Enviado parcialmente"],
    [o("open", "paid", "fulfilled"), "Enviado"],
    [o("completed", "paid", "fulfilled"), "Completado"],
    [o("cancelled", "expired"), "Cancelado"],
    [o("cancelled", "refunded"), "Reembolsado"],
    [o("open", "partially_refunded", "fulfilled"), "Reembolsado parcialmente"],
    [o("open", "paid", "unfulfilled", true), "Requiere atención"],
  ] as const)("%o → %s", (axes, label) => {
    expect(visibleStatus(axes)).toBe(label);
  });
});

describe("buyerStatus (comprador)", () => {
  const o = (status: string, payment_status: string, fulfillment_status: string) => ({
    status,
    payment_status,
    fulfillment_status,
  });
  it("retiro: «Listo para recoger» en vez de «Enviado»", () => {
    expect(buyerStatus(o("paid", "paid", "fulfilled"), { pickup: true })).toBe(
      "Listo para recoger",
    );
    expect(buyerStatus(o("paid", "paid", "partially_fulfilled"), { pickup: true })).toBe(
      "Listo para recoger en parte",
    );
    expect(buyerStatus(o("paid", "paid", "unfulfilled"), { pickup: true })).toBe(
      "Pagado — por preparar",
    );
    expect(buyerStatus(o("completed", "paid", "fulfilled"), { pickup: true })).toBe("Completado");
  });
  it("envío normal o sin dato: igual que visibleStatus", () => {
    const sent = o("paid", "paid", "fulfilled");
    expect(buyerStatus(sent)).toBe(visibleStatus(sent));
    expect(buyerStatus(sent, { pickup: false })).toBe("Enviado");
  });
});
