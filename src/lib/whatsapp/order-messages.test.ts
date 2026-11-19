import { describe, expect, it } from "vitest";

import {
  orderReceivedMessage,
  orderTicketMessage,
  type OrderTicketData,
  paymentConfirmedMessage,
  prettyPhone,
  proofMessage,
  readyForPickupMessage,
  shippedMessage,
  whatsappChatUrl,
  whatsappNumber,
} from "./order-messages";

const d = {
  storeName: "Velas Luna",
  customerName: "Ana María López",
  displayNumber: "#1042",
  total: "$1,250.00",
};

describe("whatsappNumber", () => {
  it("acepta números internacionales con +", () => {
    expect(whatsappNumber("+52 55 1234 5678", "MX")).toBe("525512345678");
    expect(whatsappNumber("+1 (415) 555-0101", "MX")).toBe("14155550101");
  });

  it("completa con 52 los celulares de 10 dígitos de una tienda en México", () => {
    expect(whatsappNumber("55-1234-5678", "MX")).toBe("525512345678");
    expect(whatsappNumber("(662) 123 4567", "mx")).toBe("526621234567");
    expect(whatsappNumber("045 55 1234 5678", "MX")).toBe("525512345678");
    expect(whatsappNumber("5215512345678", "MX")).toBe("525512345678");
    expect(whatsappNumber("525512345678", "MX")).toBe("525512345678");
  });

  it("no adivina: sin número, incompleto o de otro país sin «+» → null", () => {
    expect(whatsappNumber(null, "MX")).toBeNull();
    expect(whatsappNumber("", "MX")).toBeNull();
    expect(whatsappNumber("1234567", "MX")).toBeNull();
    expect(whatsappNumber("5512345678", "US")).toBeNull();
    expect(whatsappNumber("+12", "MX")).toBeNull();
  });
});

describe("whatsappChatUrl", () => {
  it("arma el enlace wa.me con el texto codificado", () => {
    expect(whatsappChatUrl("525512345678", "Hola, ¿#1042 & más?\nSí")).toBe(
      "https://wa.me/525512345678?text=Hola%2C%20%C2%BF%231042%20%26%20m%C3%A1s%3F%0AS%C3%AD",
    );
  });
});

describe("mensajes", () => {
  it("comprobante del comprador a la tienda", () => {
    expect(proofMessage(d)).toBe(
      "Hola, Velas Luna. Les envío el comprobante de pago de mi pedido #1042 por $1,250.00.",
    );
  });

  it("pedido recibido, con y sin instrucciones de pago", () => {
    expect(orderReceivedMessage(d)).toBe(
      "Hola, Ana. Recibimos tu pedido #1042 en Velas Luna por $1,250.00.",
    );
    expect(orderReceivedMessage({ ...d, instructions: "BBVA\nCLABE 0121 8000 1234 5678 90" })).toBe(
      "Hola, Ana. Recibimos tu pedido #1042 en Velas Luna por $1,250.00.\n\nPara pagar:\nBBVA\nCLABE 0121 8000 1234 5678 90\n\nCuando pagues, mándanos tu comprobante por aquí.",
    );
  });

  it("pago confirmado", () => {
    expect(paymentConfirmedMessage(d)).toBe(
      "Hola, Ana. Confirmamos tu pago de $1,250.00 del pedido #1042. Te avisamos por aquí cuando salga. ¡Gracias por tu compra en Velas Luna!",
    );
  });

  it("enviado con guía; sin datos opcionales no deja líneas vacías", () => {
    expect(
      shippedMessage({
        ...d,
        carrier: "Estafeta",
        trackingNumber: "ABC123",
        trackingUrl: "https://rastreo.mx/ABC123",
      }),
    ).toBe(
      "Hola, Ana. Tu pedido #1042 ya va en camino.\nPaquetería: Estafeta\nGuía: ABC123\nRastréalo aquí: https://rastreo.mx/ABC123\nGracias por tu compra en Velas Luna.",
    );
    expect(shippedMessage({ ...d, customerName: "  " })).toBe(
      "Hola. Tu pedido #1042 ya va en camino.\nGracias por tu compra en Velas Luna.",
    );
  });

  it("listo para recoger", () => {
    expect(readyForPickupMessage({ ...d, pickup: "Av. Juárez 10, Centro. L-V 10 a 18 h" })).toBe(
      "Hola, Ana. Tu pedido #1042 está listo para recoger en Velas Luna.\nAv. Juárez 10, Centro. L-V 10 a 18 h",
    );
  });
});

describe("ficha del pedido para mandar a la tienda", () => {
  const ticket: OrderTicketData = {
    storeName: "𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 |",
    displayNumber: "#1024",
    placedAt: "19 de noviembre de 2026, 2:14 p.m.",
    items: [
      { quantity: 2, title: "Vela de soya", variant: "Lavanda", lineTotal: "$500.00" },
      { quantity: 1, title: "Difusor\n  de varillas", variant: null, lineTotal: "$320.00" },
    ],
    subtotal: "$820.00",
    discount: { code: "BIENVENIDA", amount: "$50.00" },
    shipping: { name: "Estándar", amount: "$200.00" },
    tax: null,
    total: "$970.00",
    delivery: {
      kind: "address",
      recipient: "Ana María López",
      line1: "Av. Reforma 123",
      line2: "Col. Centro",
      postalCode: "83000",
      city: "Hermosillo",
      region: "Sonora",
      country: "MX",
    },
    contact: { name: "Ana María López", phone: "+526621234567", email: "ana@example.com" },
    payment: { name: "Transferencia", manual: true, paid: false },
  };

  it("arma la ficha completa: número, productos, totales, entrega, contacto y pago", () => {
    expect(orderTicketMessage(ticket)).toBe(
      [
        "*Pedido #1024 · ALIEN DEMON*",
        "Fecha: 19 de noviembre de 2026, 2:14 p.m.",
        "",
        "Hola, acabo de hacer este pedido en su tienda en línea.",
        "",
        "*Productos*",
        "• 2 × Vela de soya (Lavanda): $500.00",
        "• 1 × Difusor de varillas: $320.00",
        "",
        "Subtotal: $820.00",
        "Descuento (BIENVENIDA): −$50.00",
        "Envío (Estándar): $200.00",
        "*Total: $970.00*",
        "",
        "*Entrega a domicilio*",
        "Ana María López",
        "Av. Reforma 123, Col. Centro",
        "C.P. 83000, Hermosillo, Sonora, México",
        "",
        "*Contacto*",
        "Ana María López",
        "Cel. +52 662 123 4567",
        "ana@example.com",
        "",
        "*Pago:* Transferencia",
        "En cuanto pague, les envío mi comprobante por este chat.",
      ].join("\n"),
    );
  });

  it("recoger en tienda, sin celular ni descuento, y un pago ya hecho", () => {
    const text = orderTicketMessage({
      ...ticket,
      discount: null,
      shipping: { name: null, amount: "Gratis" },
      delivery: { kind: "pickup", address: "Calle 5 #20, Hermosillo" },
      contact: { name: "Ana", phone: null, email: "ana@example.com" },
      payment: { name: "Tarjeta", manual: false, paid: true },
    });
    expect(text).toContain("Envío: Gratis");
    expect(text).toContain("*Entrega:* recoger en tienda\nCalle 5 #20, Hermosillo");
    expect(text).not.toContain("Descuento");
    expect(text).not.toContain("Cel.");
    expect(text).toContain("*Pago:* Tarjeta (pagado)");
    expect(text).not.toContain("comprobante");
  });

  it("muchos productos: los primeros 25 y cuántos faltan (el enlace no se vuelve enorme)", () => {
    const items = Array.from({ length: 27 }, (_, i) => ({
      quantity: 1,
      title: `Producto ${i + 1}`,
      variant: null,
      lineTotal: "$10.00",
    }));
    const text = orderTicketMessage({ ...ticket, items });
    expect(text).toContain("• 1 × Producto 25: $10.00");
    expect(text).not.toContain("Producto 26");
    expect(text).toContain("• y 2 productos más");
    expect(whatsappChatUrl("16503008656", text).length).toBeLessThan(4000);
  });

  it("celulares legibles", () => {
    expect(prettyPhone("+526621234567")).toBe("+52 662 123 4567");
    expect(prettyPhone("+16503008656")).toBe("+1 650 300 8656");
    expect(prettyPhone("+447700900123")).toBe("+447700900123");
  });
});
