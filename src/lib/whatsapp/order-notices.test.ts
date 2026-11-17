import { describe, expect, it } from "vitest";

import { orderWhatsappNotices } from "./order-notices";

const base = {
  storeName: "Velas Luna",
  storeCountry: "MX",
  customerName: "Ana López",
  customerPhone: "55 1234 5678",
  shipments: [],
  paymentInstructions: "CLABE 0121",
};
const order = {
  displayNumber: "#7",
  status: "pending_payment",
  paidTotal: 0,
  total: "$100.00",
  pickup: false,
};

describe("orderWhatsappNotices", () => {
  it("sin celular o con uno que no se entiende, lo dice en vez de ofrecer enlaces", () => {
    expect(orderWhatsappNotices({ ...base, customerPhone: null, order })).toEqual({
      ok: false,
      reason: "no_phone",
    });
    expect(orderWhatsappNotices({ ...base, customerPhone: "123", order })).toEqual({
      ok: false,
      reason: "bad_phone",
    });
  });

  it("esperando el pago: solo «Pedido recibido», con las instrucciones", () => {
    const r = orderWhatsappNotices({ ...base, order });
    expect(r.ok && r.notices.map((n) => n.label)).toEqual(["Pedido recibido"]);
    const url = r.ok ? r.notices[0]!.url : "";
    expect(url.startsWith("https://wa.me/525512345678?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("CLABE 0121");
  });

  it("pagado: «Pago confirmado»; si es para recoger, también «Listo para recoger»", () => {
    const paid = { ...order, status: "paid", paidTotal: 10000 };
    const r = orderWhatsappNotices({ ...base, order: paid });
    expect(r.ok && r.notices.map((n) => n.label)).toEqual(["Pago confirmado"]);
    const p = orderWhatsappNotices({ ...base, order: { ...paid, pickup: true } });
    expect(p.ok && p.notices.map((n) => n.label)).toEqual([
      "Pago confirmado",
      "Listo para recoger",
    ]);
  });

  it("con guía: un aviso por envío con guía; sin guía no se ofrece", () => {
    const paid = { ...order, status: "fulfilled", paidTotal: 10000 };
    const r = orderWhatsappNotices({
      ...base,
      order: paid,
      shipments: [
        { id: "s1", carrier: "Estafeta", trackingNumber: "ABC", trackingUrl: null },
        { id: "s2", carrier: null, trackingNumber: null, trackingUrl: null },
      ],
    });
    expect(r.ok && r.notices.map((n) => n.key)).toEqual(["paid", "shipped-s1"]);
    expect(r.ok && r.notices[1]!.label).toBe("Enviado (guía ABC)");
    expect(decodeURIComponent((r.ok ? r.notices[1]!.url : "").split("text=")[1]!)).toContain(
      "Guía: ABC",
    );
  });

  it("cancelado: ningún aviso", () => {
    const r = orderWhatsappNotices({ ...base, order: { ...order, status: "cancelled" } });
    expect(r).toEqual({ ok: true, notices: [] });
  });
});
