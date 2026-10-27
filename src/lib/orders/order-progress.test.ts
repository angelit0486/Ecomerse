import { describe, expect, it } from "vitest";

import { orderProgress } from "./order-progress";

const axes = (status: string, payment_status: string, fulfillment_status = "unfulfilled") => ({
  status,
  payment_status,
  fulfillment_status,
});
const done = (o: ReturnType<typeof axes>) => orderProgress(o)?.map((s) => s.done);
const current = (o: ReturnType<typeof axes>) =>
  orderProgress(o)?.find((s) => s.current)?.label ?? null;

describe("orderProgress", () => {
  it("pendiente de pago: solo recibido; lo siguiente es el pago", () => {
    expect(done(axes("pending_payment", "pending"))).toEqual([true, false, false, false]);
    expect(current(axes("pending_payment", "pending"))).toBe("Pago confirmado");
  });

  it("pagado y enviado; luego completado", () => {
    expect(current(axes("paid", "paid"))).toBe("Enviado");
    expect(current(axes("paid", "paid", "fulfilled"))).toBe("Entregado");
    expect(done(axes("completed", "paid", "fulfilled"))).toEqual([true, true, true, true]);
    expect(current(axes("completed", "paid", "fulfilled"))).toBeNull();
  });

  it("cancelado, reembolsado o en revisión no muestra pasos", () => {
    expect(orderProgress(axes("cancelled", "pending"))).toBeNull();
    expect(orderProgress(axes("paid", "refunded"))).toBeNull();
    expect(orderProgress({ ...axes("paid", "paid"), needs_attention: true })).toBeNull();
  });
});
