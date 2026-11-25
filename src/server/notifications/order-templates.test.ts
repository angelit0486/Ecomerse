import { describe, expect, it } from "vitest";

import {
  addressLines,
  deliveryEstimate,
  orderConfirmationEmail,
  orderPendingPaymentEmail,
  orderDeliveredEmail,
  orderLinkEmail,
  orderReceivedEmail,
  orderShippedEmail,
  paymentMethodLabel,
  staffOrderEmail,
  type OrderEmailData,
  returnDecisionEmail,
  returnRequestedEmail,
  type ReturnEmailData,
  staffReturnEmail,
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

  it("pendiente de pago (ADR-056): número, productos, total, dirección e instrucción del medio", () => {
    const d: OrderEmailData = {
      ...base,
      order: {
        ...base.order,
        shipping_address: {
          recipient_name: "Ana",
          line1: "Av. Juárez 10",
          line2: "Centro",
          postal_code: "72000",
          city: "Puebla",
          region: "Puebla",
          country: "MX",
        },
      },
    };
    const oxxo = orderPendingPaymentEmail(d, "c@x.test", "ticket");
    expect(oxxo.subject).toBe(`Tu pedido ${base.order.display_number} está pendiente de pago`);
    expect(oxxo.text).toContain("OXXO");
    expect(oxxo.text).toContain("Total: ");
    expect(oxxo.text).toContain("Av. Juárez 10");
    expect(oxxo.html).toContain("pendiente de pago");
    expect(oxxo.text).not.toContain("Recibimos tu pago");
    expect(orderPendingPaymentEmail(d, "c@x.test", "bank_transfer").text).toContain(
      "transferencia",
    );
    expect(orderPendingPaymentEmail(d, "c@x.test", "otro").text).toContain(
      "instrucciones de Mercado Pago",
    );
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

describe("recoger en tienda (shipping_type = pickup)", () => {
  // Pickup también pide la dirección del comprador en el checkout: el pedido la trae.
  const buyer = {
    recipient_name: "Ana",
    line1: "Calle del comprador 9",
    line2: null,
    postal_code: "82000",
    city: "Mazatlán",
    region: "Sinaloa",
    country: "MX",
  };
  const pickup: OrderEmailData = {
    ...base,
    order: {
      ...base.order,
      shipping_name: "Recoger en tienda",
      shipping_type: "pickup",
      estimated_days: { min: 1, max: 3 },
      shipping_address: buyer,
      pickup: { address: "Av. Juárez 10 <b>\nCentro, Puebla", hours: "L-V 9 a 18 & S 10 a 14" },
    },
    payment: { display_name: "Transferencia", instructions: "CLABE 123", method: null },
  };
  const noAddress: OrderEmailData = { ...pickup, order: { ...pickup.order, pickup: null } };
  const panel = "https://panel.test/admin/t/pedidos/1";

  it("confirmación: «Recoges en» con dirección multilínea y horario, sin envío ni entrega estimada", () => {
    const m = orderConfirmationEmail(pickup, "c@x.test");
    expect(m.html).toContain(
      "<strong>Recoges en:</strong><br>Av. Juárez 10 &lt;b&gt;<br>Centro, Puebla<br><strong>Horario:</strong> L-V 9 a 18 &amp; S 10 a 14",
    );
    expect(m.text).toContain(
      "Recoges en:\nAv. Juárez 10 <b>\nCentro, Puebla\nHorario: L-V 9 a 18 & S 10 a 14",
    );
    for (const body of [m.html, m.text]) {
      expect(body).not.toContain("Enviaremos a");
      expect(body).not.toContain("Entrega estimada");
      expect(body).not.toContain("Calle del comprador 9");
    }
    expect(m.html).not.toContain("<b>\n");
    expect(m.html).not.toContain("Av. Juárez 10 <b>");
  });

  it("recibido (pago manual) y pendiente de pago también dicen dónde recoger", () => {
    for (const m of [
      orderReceivedEmail(pickup, "c@x.test"),
      orderPendingPaymentEmail(pickup, "c@x.test", "ticket"),
    ]) {
      expect(m.html).toContain("<strong>Recoges en:</strong><br>Av. Juárez 10 &lt;b&gt;");
      expect(m.text).toContain("Recoges en:\nAv. Juárez 10 <b>\nCentro, Puebla");
      expect(m.text).toContain("Horario: L-V 9 a 18 & S 10 a 14");
      expect(m.text).not.toContain("Enviaremos a");
      expect(m.text).not.toContain("Calle del comprador 9");
    }
  });

  it("sin horario: solo la dirección", () => {
    const m = orderConfirmationEmail(
      { ...pickup, order: { ...pickup.order, pickup: { address: "Calle 1", hours: null } } },
      "c@x.test",
    );
    expect(m.html).toContain("<strong>Recoges en:</strong><br>Calle 1</p>");
    expect(m.text).not.toContain("Horario");
  });

  it("sin dirección declarada: solo se omite lo falso, no se inventa nada", () => {
    for (const m of [
      orderConfirmationEmail(noAddress, "c@x.test"),
      orderReceivedEmail(noAddress, "c@x.test"),
      orderPendingPaymentEmail(noAddress, "c@x.test", "ticket"),
    ]) {
      for (const body of [m.html, m.text]) {
        expect(body).not.toContain("Enviaremos a");
        expect(body).not.toContain("Entrega estimada");
        expect(body).not.toContain("Recoges en");
        expect(body).not.toContain("Horario");
        expect(body).not.toContain("Calle del comprador 9");
      }
    }
    // Una dirección de puros espacios cuenta como vacía.
    const blank = orderConfirmationEmail(
      { ...pickup, order: { ...pickup.order, pickup: { address: " \n ", hours: "L-V" } } },
      "c@x.test",
    );
    expect(blank.html).not.toContain("Recoges en");
    expect(blank.html).not.toContain("Horario");
  });

  it("staff: «El cliente recoge en tienda», con lo que se le dijo y sin «Enviaremos a»", () => {
    const m = staffOrderEmail(pickup, "s@x.test", "paid", panel);
    expect(m.html).toContain(
      "<strong>El cliente recoge en tienda:</strong><br>Av. Juárez 10 &lt;b&gt;<br>Centro, Puebla",
    );
    expect(m.text).toContain("El cliente recoge en tienda:\nAv. Juárez 10 <b>");
    expect(m.text).not.toContain("Enviaremos a");
    expect(m.text).not.toContain("Calle del comprador 9");
    const bare = staffOrderEmail(noAddress, "s@x.test", "new", panel);
    expect(bare.html).toContain("<strong>El cliente recoge en tienda.</strong>");
    expect(bare.text).toContain("El cliente recoge en tienda.");
    expect(bare.text).not.toContain("Enviaremos a");
    expect(bare.text).not.toContain("Calle del comprador 9");
  });

  it("envío normal: sin cambios (aunque la tienda haya declarado dirección)", () => {
    const shipped: OrderEmailData = {
      ...pickup,
      order: { ...pickup.order, shipping_name: "Estándar", shipping_type: "flat" },
    };
    const m = orderConfirmationEmail(shipped, "c@x.test");
    expect(m.html).toContain("Enviaremos a:");
    expect(m.html).toContain("Calle del comprador 9");
    expect(m.html).toContain("<strong>Entrega estimada:</strong> Llega en 1 a 3 días");
    expect(m.html).not.toContain("Recoges en");
    expect(orderReceivedEmail(shipped, "c@x.test").text).not.toContain("Recoges en");
    expect(orderReceivedEmail(shipped, "c@x.test").text).not.toContain("Enviaremos a");
    expect(staffOrderEmail(shipped, "s@x.test", "paid", panel).html).toContain("Enviaremos a:");
    expect(staffOrderEmail(shipped, "s@x.test", "paid", panel).html).not.toContain("recoge");
    // Sin shipping_type (correos encolados antes de la migración): como siempre.
    const legacy = orderConfirmationEmail(
      { ...shipped, order: { ...shipped.order, shipping_type: undefined, pickup: undefined } },
      "c@x.test",
    );
    expect(legacy.html).toContain("Enviaremos a:");
    expect(legacy.html).toContain("Entrega estimada:");
  });
});

describe("devoluciones (ADR-061)", () => {
  const r: ReturnEmailData = {
    status: "requested",
    reason: "damaged",
    customer_message: null,
    customer_note: "El asa <b>venía</b> rota",
    items: [{ title: "Taza", variant: "Azul", quantity: 1 }],
  };

  it("acuse al cliente con lo que pidió devolver y el enlace al pedido", () => {
    const m = returnRequestedEmail(base, r, "ana@example.test");
    expect(m.subject).toBe(
      `Recibimos tu solicitud de devolución del pedido ${base.order.display_number}`,
    );
    expect(m.text).toContain("- Taza (Azul) × 1");
  });

  it("aprobada lleva las instrucciones; rechazada, el motivo (escapados)", () => {
    const ok = returnDecisionEmail(
      base,
      { ...r, status: "approved", customer_message: "Envíala a <Reforma 22>" },
      "ana@example.test",
      true,
    );
    expect(ok.subject).toMatch(/fue aprobada$/);
    expect(ok.text).toContain("Instrucciones de la tienda: Envíala a <Reforma 22>");
    expect(ok.html).toContain("Envíala a &lt;Reforma 22&gt;");
    const no = returnDecisionEmail(
      base,
      { ...r, status: "rejected", customer_message: "Pasaron más de 30 días" },
      "ana@example.test",
      false,
    );
    expect(no.subject).toMatch(/no fue aprobada$/);
    expect(no.text).toContain("Motivo: Pasaron más de 30 días");
  });

  it("a la tienda: motivo en español, nota del cliente escapada y enlace al panel", () => {
    const m = staffReturnEmail(
      base,
      r,
      "tienda@example.test",
      "https://app.test/admin/x/pedidos/devoluciones/1",
    );
    expect(m.subject).toBe(`Devolución solicitada: pedido ${base.order.display_number}`);
    expect(m.text).toContain("Motivo: Llegó dañado");
    expect(m.html).toContain("El asa &lt;b&gt;venía&lt;/b&gt; rota");
    expect(m.html).toContain("https://app.test/admin/x/pedidos/devoluciones/1");
  });
});

describe("enlace nuevo del pedido (ADR-062)", () => {
  it("lleva el enlace, dice que el anterior ya no sirve y escapa los datos", () => {
    const m = orderLinkEmail(base, "c@x.test");
    expect(m.to).toBe("c@x.test");
    expect(m.subject).toBe("Tu enlace para ver el pedido #1001");
    expect(m.html).toContain('href="https://tienda.test/pedido/1?t=abc"');
    expect(m.html).toContain("El enlace anterior ya no funciona");
    expect(m.html).not.toContain("<script>");
    expect(m.text).toContain("Tu pedido: https://tienda.test/pedido/1?t=abc");
    expect(m.text).toContain("Si no lo pediste tú");
  });
});

describe("promociones en los correos del pedido (ADR-070, fase 3)", () => {
  const promo: OrderEmailData = {
    ...base,
    order: {
      ...base.order,
      subtotal: 32000,
      discount_total: 11000,
      promotion_total: 10000,
      promotions: [{ label: "3×2 <en> playeras", amount: 10000 }],
      total: 21000,
    },
    items: [
      {
        title: "Playera",
        variant: "CH",
        quantity: 2,
        line_total: 9000,
        unit_price: 10000,
        promotion_allocation: 10000,
        promotion_labels: ["3×2 <en> playeras"],
      },
      { title: "Playera", variant: "G", quantity: 1, line_total: 11000, promotion_allocation: 0 },
    ],
  };

  it("cada partida dice su ahorro y los totales separan promoción y cupón", () => {
    const m = orderConfirmationEmail(promo, "c@x.test");
    expect(m.html).toContain("3×2 &lt;en&gt; playeras: −$100.00");
    expect(m.html).toContain("Promoción: 3×2 &lt;en&gt; playeras");
    expect(m.html).toContain('>Descuento</td><td style="text-align:right">−$10.00');
    expect(m.html).not.toContain("<en>");
    expect(m.text).toContain("2 × Playera (CH): $90.00 (3×2 <en> playeras: −$100.00)");
    expect(m.text).toContain("Promoción: 3×2 <en> playeras: −$100.00");
  });

  it("también en el correo de pedido recibido y en el de la tienda", () => {
    expect(orderReceivedEmail(promo, "c@x.test").html).toContain("−$100.00");
    expect(staffOrderEmail(promo, "s@x.test", "new", "https://panel.test/p").html).toContain(
      "Promoción: 3×2",
    );
  });

  it("sin promociones, el correo no cambia", () => {
    const m = orderConfirmationEmail(
      { ...base, order: { ...base.order, discount_total: 1000, total: 9000 } },
      "c@x.test",
    );
    expect(m.html).toContain(">Descuento<");
    expect(m.html).not.toContain("Promoci");
  });
});
