import { describe, expect, it } from "vitest";

import {
  addressLines,
  orderConfirmationEmail,
  orderDeliveredEmail,
  orderShippedEmail,
  staffOrderEmail,
  type OrderEmailData,
} from "./order-templates";

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

  it("entregado: invita a opinar con el enlace del pedido y escapa los datos", () => {
    const m = orderDeliveredEmail(
      { ...base, orderUrl: "https://tienda.test/pedido/1?t=x" },
      "c@x.test",
    );
    expect(m.subject).toContain("fue entregado");
    expect(m.html).toContain("Opinar sobre mi compra");
    expect(m.text).toContain("#opinar");
    expect(m.html).not.toContain("<script");
  });

  it("entregado sin pagar (p. ej. contra entrega pendiente): no invita a opinar", () => {
    const m = orderDeliveredEmail(
      { ...base, orderUrl: "https://tienda.test/pedido/1?t=x" },
      "c@x.test",
      { inviteReview: false },
    );
    expect(m.subject).toContain("fue entregado");
    expect(m.html).not.toContain("Opinar sobre mi compra");
    expect(m.text).not.toContain("#opinar");
    expect(m.text).not.toContain("Tu opinión");
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

  it("staff: contracargo y reembolso externo, cada uno con su aviso (ADR-043)", () => {
    const c = staffOrderEmail(base, "s@x.test", "chargeback", "https://panel.test/p");
    expect(c.subject).toBe("Atención: contracargo en el pedido #1001");
    expect(c.text).toContain("detén el envío");
    const r = staffOrderEmail(base, "s@x.test", "external_refund", "https://panel.test/p");
    expect(r.subject).toContain("se reembolsó fuera de la tienda");
    expect(r.text).toContain("https://panel.test/p");
  });

  it("confirmación: dirección de envío completa, escapada y en texto plano", () => {
    const m = orderConfirmationEmail(
      {
        ...base,
        order: {
          ...base.order,
          shipping_address: {
            recipient_name: "Ana <b>López</b>",
            line1: "Av. Juárez 10",
            line2: "Col. Centro",
            postal_code: "82000",
            city: "Mazatlán",
            region: "Sinaloa",
            country: "MX",
          },
        },
      },
      "c@x.test",
    );
    expect(m.html).toContain("Enviaremos a:");
    expect(m.html).toContain("Ana &lt;b&gt;López&lt;/b&gt;");
    expect(m.html).toContain("Av. Juárez 10, Col. Centro");
    expect(m.html).toContain("82000 Mazatlán, Sinaloa, MX");
    expect(m.html).not.toContain("<b>López");
    expect(m.text).toContain("Enviaremos a:\nAna <b>López</b>\nAv. Juárez 10, Col. Centro");
    expect(m.text).toContain("Total: ");
  });

  it("confirmación sin envío: no muestra dirección", () => {
    const m = orderConfirmationEmail(base, "c@x.test");
    expect(m.html).not.toContain("Enviaremos a:");
    expect(addressLines(null)).toEqual([]);
    expect(
      addressLines({
        recipient_name: "Ana",
        line1: "Calle 1",
        line2: null,
        postal_code: null,
        city: "León",
        region: null,
        country: null,
      }),
    ).toEqual(["Ana", "Calle 1", "León"]);
  });
});
