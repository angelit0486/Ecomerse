import { describe, expect, it } from "vitest";

import { orderShippedEmail, staffOrderEmail, type OrderEmailData } from "./order-templates";

const base: OrderEmailData = {
  store: {
    name: 'Tienda "<b>"',
    locale: "es-MX",
    currency: "MXN",
    contact_email: "hola@tienda.test",
    logoUrl: null,
    primary_color: null,
  },
  order: {
    display_number: "#1001",
    customer_name: "<script>alert(1)</script>",
    subtotal: 10000,
    discount_total: 0,
    shipping_total: 0,
    tax_total: 0,
    total: 10000,
    prices_include_tax: true,
    shipping_name: null,
  },
  items: [{ title: "Taza <i>", variant: null, quantity: 1, line_total: 10000 }],
  orderUrl: "https://tienda.test/pedido/1?t=abc",
  shipment: { carrier: "DHL", tracking_number: "X1", tracking_url: "javascript:alert(1)" },
};

describe("plantillas de pedidos", () => {
  it("escapa todo dato variable", () => {
    const m = orderShippedEmail(base, "c@x.test");
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<i>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.fromName).toBe('Tienda "<b>"');
    expect(m.replyTo).toBe("hola@tienda.test");
    expect(m.html).not.toContain("javascript:");
    expect(m.html).toContain('href="https://tienda.test/pedido/1?t=abc"');
  });

  it("logo solo https y color solo hex", () => {
    const http = orderShippedEmail(
      { ...base, store: { ...base.store, logoUrl: "http://x/l.png" } },
      "c@x.test",
    );
    expect(http.html).not.toContain("<img");
    const ok = orderShippedEmail(
      {
        ...base,
        store: { ...base.store, logoUrl: "https://x/l.png", primary_color: "red;x:url(1)" },
      },
      "c@x.test",
    );
    expect(ok.html).toContain('<img src="https://x/l.png"');
    expect(ok.html).not.toContain("red;x");
  });

  it("staff: sin datos de contacto del comprador ni remitente de la tienda", () => {
    const m = staffOrderEmail(base, "s@x.test", "paid", "https://panel.test/admin/t/pedidos/1");
    expect(m.text).toContain("https://panel.test/admin/t/pedidos/1");
    expect(m.replyTo).toBeUndefined();
    expect(m.fromName).toBeUndefined();
  });

  it("staff: pago después de cancelar con su propio aviso", () => {
    const m = staffOrderEmail(base, "s@x.test", "paid_after_cancel", "https://panel.test/p");
    expect(m.subject).toContain("pedido cancelado #1001");
    expect(m.text).toContain("reembolso automáticamente");
  });
});
