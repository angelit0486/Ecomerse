import { describe, expect, it } from "vitest";

import { weekChange, weeklySummaryEmail, type WeeklySummary } from "./weekly-summary";

const base: WeeklySummary = {
  store: { id: "s", name: "Tienda <b>&</b>", handle: "t", organization_id: "o", currency: "MXN" },
  recipients: ["a@x.test"],
  sales: 30000,
  orders: 2,
  sales_prev: 24000,
  refunds: 5000,
  to_fulfill: 1,
  needs_attention: 0,
  pending_payment: 2,
  abandoned_carts: 3,
  low_stock: [{ title: "Taza <script>", sku: "TAZA-1", available: 1 }],
  top_products: [{ title: "Vela", quantity: 4 }],
};

describe("resumen semanal (paso 19)", () => {
  it("compara contra la semana anterior", () => {
    expect(weekChange(30000, 24000)).toBe("+25 % contra la semana anterior");
    expect(weekChange(18000, 24000)).toBe("−25 % contra la semana anterior");
    expect(weekChange(100, 100)).toBe("igual que la semana anterior");
    expect(weekChange(100, 0)).toBeNull();
  });

  it("ventas, netas, pendientes, lo más vendido y stock bajo, todo escapado", () => {
    const m = weeklySummaryEmail(base, "a@x.test", "https://panel.test/admin/t");
    // El asunto pasa por safeDisplayName: sin «<» ni «>».
    expect(m.subject).toBe("Tu semana en Tienda b&/b: $300.00 en ventas");
    expect(m.text).toContain("Ventas (7 días): $300.00 · +25 % contra la semana anterior");
    expect(m.text).toContain("Ventas netas: $250.00");
    expect(m.text).toContain("- 1 pedido(s) por surtir");
    expect(m.text).toContain("- 2 pedido(s) pendientes de pago");
    expect(m.text).not.toContain("requieren atención");
    expect(m.text).toContain("- 4 × Vela");
    expect(m.text).toContain("Taza <script> (TAZA-1): quedan 1");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("Taza &lt;script&gt;");
    expect(m.html).toContain('href="https://panel.test/admin/t"');
  });

  it("sin pendientes lo dice", () => {
    const m = weeklySummaryEmail(
      { ...base, to_fulfill: 0, pending_payment: 0, low_stock: [] },
      "a@x.test",
      "https://panel.test/admin/t",
    );
    expect(m.text).toContain("No tienes nada pendiente.");
  });
});
