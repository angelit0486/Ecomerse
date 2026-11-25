import { describe, expect, it } from "vitest";

import { discountShare, promotionsReportSchema, reachLabel } from "./report";

describe("reporte de promociones", () => {
  it("valida lo que manda la base", () => {
    const ok = promotionsReportSchema.safeParse({
      from: "2026-10-27",
      to: "2026-11-25",
      currency: "MXN",
      rows: [
        {
          promotion_id: "a",
          name: "Playeras 3x2",
          label: "3×2",
          type: "buy_n_pay_m",
          status: "active",
          orders: 1,
          units: 3,
          discount: 10000,
          sales: 20000,
        },
      ],
      totals: { orders: 1, discount: 10000, sales: 20000, paid_orders: 4 },
    });
    expect(ok.success).toBe(true);
    expect(promotionsReportSchema.safeParse({ rows: "x" }).success).toBe(false);
  });

  it("alcance: qué parte de los pedidos usó una promoción", () => {
    expect(reachLabel({ orders: 3, discount: 1, sales: 1, paid_orders: 10 })).toBe(
      "3 de 10 pedidos pagados (30 %) usaron una promoción.",
    );
    expect(reachLabel({ orders: 1, discount: 1, sales: 1, paid_orders: 1 })).toBe(
      "1 de 1 pedido pagado (100 %) usó una promoción.",
    );
    expect(reachLabel({ orders: 0, discount: 0, sales: 0, paid_orders: 0 })).toBeNull();
  });

  it("el ahorro sobre lo que se habría cobrado", () => {
    expect(discountShare({ discount: 10000, sales: 20000 })).toBe("33.3 %");
    expect(discountShare({ discount: 0, sales: 20000 })).toBeNull();
  });
});
