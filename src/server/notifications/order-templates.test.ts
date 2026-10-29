import { describe, expect, it } from "vitest";

import {
  addressLines,
  deliveryEstimate,
  orderConfirmationEmail,
  orderDeliveredEmail,
  orderShippedEmail,
  paymentMethodLabel,
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

describe("confirmación completa (misión pagos, 2026-10-29)", () => {
  const full: OrderEmailData = {
    ...base,
    order: {
      ...base.order,
      estimated_days: { min: 2, max: 5 },
      shipping_address: {
        recipient_name: "Ana",
        line1: "Calle 1",
        line2: null,
        postal_code: "82000",
        city: "Mazatlán",
        region: "Sinaloa",
        country: "MX",
      },
    },
    items: [
      {
        title: "Proteína",
        variant: "Vainilla 1 kg",
        quantity: 2,
        unit_price: 45000,
        line_total: 90000,
        image_url: "https://media.test/p.webp",
      },
      {
        title: "Shaker",
        variant: null,
        quantity: 1,
        unit_price: 9900,
        line_total: 9900,
        image_url: "javascript:alert(1)",
      },
    ],
    payment: { display_name: "Mercado Pago", instructions: null, method: "credit_card" },
  };

  it("miniaturas solo https, presentación, precio unitario, pago, entrega y seguimiento", () => {
    const m = orderConfirmationEmail(full, "c@x.test");
    expect(m.html).toContain('<img src="https://media.test/p.webp"');
    expect(m.html).not.toContain("javascript:");
    expect(m.html).toContain("2 × Proteína (Vainilla 1 kg)");
    expect(m.html).toContain("c/u");
    expect(m.html).toContain("Tarjeta de crédito · Mercado Pago");
    expect(m.html).toContain("Llega en 2 a 5 días");
    expect(m.html).toContain("Seguir mi pedido");
    expect(m.text).toContain("Pagaste con: Tarjeta de crédito · Mercado Pago");
    expect(m.text).toContain("Sigue tu pedido: https://tienda.test/pedido/1?t=abc");
  });

  it("el método de pago nunca muestra datos de la tarjeta", () => {
    expect(
      paymentMethodLabel({ display_name: "Tarjeta", instructions: null, method: "4242" }),
    ).toBe("Tarjeta");
    expect(paymentMethodLabel(null)).toBeNull();
  });

  it("entrega estimada: rango, un solo valor o nada", () => {
    expect(deliveryEstimate(full)).toBe("Llega en 2 a 5 días");
    expect(
      deliveryEstimate({ ...full, order: { ...full.order, estimated_days: { min: 1, max: 1 } } }),
    ).toBe("Llega en 1 día");
    expect(
      deliveryEstimate({ ...full, order: { ...full.order, estimated_days: null } }),
    ).toBeNull();
  });

  it("envío parcial: asunto y paquete distintos al envío completo", () => {
    const partial = orderShippedEmail(
      {
        ...full,
        shipment: {
          carrier: "DHL",
          tracking_number: "X1",
          tracking_url: null,
          partial: true,
          items: [{ title: "Shaker <b>", variant: null, quantity: 1 }],
        },
      },
      "c@x.test",
    );
    expect(partial.subject).toBe("Parte de tu pedido #1001 va en camino");
    expect(partial.html).toContain("En este paquete:");
    expect(partial.html).toContain("1 × Shaker &lt;b&gt;");
    const whole = orderShippedEmail(
      { ...full, shipment: { ...full.shipment!, partial: false } },
      "c@x.test",
    );
    expect(whole.subject).toBe("Tu pedido #1001 va en camino");
  });

  it("la tienda recibe los mismos datos y el enlace al panel", () => {
    const m = staffOrderEmail(full, "t@x.test", "paid", "https://panel.test/admin/t/pedidos/1");
    expect(m.html).toContain("Enviaremos a:");
    expect(m.html).toContain("Tarjeta de crédito · Mercado Pago");
    expect(m.html).toContain("2 × Proteína");
    expect(m.text).toContain("Panel: https://panel.test/admin/t/pedidos/1");
    expect(m.html).toContain("&lt;script&gt;");
  });
});
