import { describe, expect, it } from "vitest";

import {
  isSupplierOrderStatus,
  nextSupplierOrderStatuses,
  SUPPLIER_ORDER_ACTIONS,
  SUPPLIER_ORDER_LABELS,
  SUPPLIER_ORDER_STATUSES,
} from "./supplier-order-status";

describe("estados del despacho del proveedor", () => {
  it("avanza y permite saltar pasos, nunca regresar", () => {
    expect(nextSupplierOrderStatuses("pending")).toEqual([
      "requested",
      "confirmed",
      "shipped",
      "delivered",
      "failed",
      "cancelled",
    ]);
    expect(nextSupplierOrderStatuses("shipped")).toEqual(["delivered", "failed", "cancelled"]);
  });

  it("entregado y cancelado son finales; con problema vuelve a pendiente o se cancela", () => {
    expect(nextSupplierOrderStatuses("delivered")).toEqual([]);
    expect(nextSupplierOrderStatuses("cancelled")).toEqual([]);
    expect(nextSupplierOrderStatuses("failed")).toEqual(["pending", "cancelled"]);
  });

  it("todo estado tiene etiqueta y acción en español", () => {
    for (const s of SUPPLIER_ORDER_STATUSES) {
      expect(SUPPLIER_ORDER_LABELS[s]).toBeTruthy();
      expect(SUPPLIER_ORDER_ACTIONS[s]).toBeTruthy();
    }
    expect(isSupplierOrderStatus("shipped")).toBe(true);
    expect(isSupplierOrderStatus("sent")).toBe(false);
  });
});
