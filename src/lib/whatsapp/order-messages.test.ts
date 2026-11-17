import { describe, expect, it } from "vitest";

import {
  orderReceivedMessage,
  paymentConfirmedMessage,
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
