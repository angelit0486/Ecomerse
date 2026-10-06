import { describe, expect, it } from "vitest";

import { visibleStatus } from "./visible-status";

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
