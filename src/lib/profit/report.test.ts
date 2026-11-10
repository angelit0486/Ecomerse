import { describe, expect, it } from "vitest";

import {
  marginLabel,
  minusDays,
  profitNotes,
  profitReportSchema,
  revenueWithCost,
  type ProfitReport,
} from "./report";

const base: ProfitReport = {
  from: "2026-03-10",
  to: "2026-03-10",
  orders: 5,
  cancelled_orders: 0,
  revenue: 61000,
  revenue_without_cost: 5000,
  cost: 29999,
  other_refunds: 2000,
  profit: 24001,
  units_without_cost: 0,
  units_current_cost: 0,
  shipping_charged: 0,
  tax: 3000,
  products: [],
  order_rows: [],
};

describe("reporte de rentabilidad", () => {
  it("el margen sale con un decimal y sin flotantes", () => {
    expect(marginLabel(24001, 56000)).toBe("42.9 %");
    expect(marginLabel(1, 3)).toBe("33.3 %");
    expect(marginLabel(-500, 10000)).toBe("−5.0 %");
    expect(marginLabel(0, 10000)).toBe("0.0 %");
  });

  it("sin venta o sin costo no se inventa el margen", () => {
    expect(marginLabel(null, 10000)).toBe("—");
    expect(marginLabel(100, 0)).toBe("—");
  });

  it("la utilidad se compara con la venta que tiene costo", () => {
    expect(revenueWithCost(base)).toBe(56000);
  });

  it("siempre dice lo que falta descontar; lo demás solo si aplica", () => {
    expect(profitNotes(base)).toEqual([
      "Todavía no se descuentan las comisiones de tu medio de pago ni lo que te cuesta el envío.",
    ]);
    const notes = profitNotes({
      ...base,
      units_without_cost: 2,
      units_current_cost: 1,
      cancelled_orders: 1,
    });
    expect(notes).toHaveLength(4);
    expect(notes[0]).toContain("2 unidades vendidas no tienen costo");
    expect(notes[1]).toContain("1 unidad se vendió antes");
    expect(notes[2]).toBe("1 pedido cancelado no se cuenta.");
  });

  it("valida lo que devuelve la base (centavos enteros, utilidad opcional por fila)", () => {
    const parsed = profitReportSchema.parse({
      ...base,
      timezone: "America/Mexico_City",
      products: [
        { product_id: null, title: "Vela", units: 1, revenue: 5000, cost: null, profit: null },
      ],
      order_rows: [
        {
          order_id: "0191f3a0-0000-7000-8000-000000000001",
          number: "#1001",
          paid_at: "2026-03-10T18:00:00+00:00",
          revenue: 5000,
          cost: 0,
          other_refunds: 0,
          profit: null,
        },
      ],
    });
    expect(parsed.products[0]!.profit).toBeNull();
    expect(profitReportSchema.safeParse({ ...base, profit: 10.5 }).success).toBe(false);
  });

  it("resta días de calendario", () => {
    expect(minusDays("2026-03-01", 1)).toBe("2026-02-28");
    expect(minusDays("2026-03-10", 6)).toBe("2026-03-04");
  });
});
