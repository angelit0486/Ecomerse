import { describe, expect, it } from "vitest";

import { getSupplierProvider, ManualStepRequired } from "./provider";

describe("adaptador de proveedor", () => {
  it("el manual no automatiza nada y no finge respuestas", async () => {
    const p = getSupplierProvider("manual");
    expect(p.capabilities).toEqual([]);
    await expect(p.fetchAvailability(["X"])).rejects.toBeInstanceOf(ManualStepRequired);
    await expect(
      p.submitOrder({ supplierOrderId: "a", orderNumber: "#1", items: [] }),
    ).rejects.toThrow("manual_step_required:submit_order");
    await expect(p.getOrderStatus("PO-1")).rejects.toThrow("manual_step_required:order_status");
  });

  it("un adaptador desconocido es un error, no un manual silencioso", () => {
    expect(() => getSupplierProvider("acme")).toThrow("desconocido");
  });
});
