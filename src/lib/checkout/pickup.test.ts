import { describe, expect, it } from "vitest";

import { orderPickupInfo, pickupInfo } from "./pickup";

describe("pickupInfo", () => {
  it("devuelve dirección y horario declarados", () => {
    expect(pickupInfo({ address: " Calle 5 #10, Hermosillo ", hours: "L-S 10-19" })).toEqual({
      address: "Calle 5 #10, Hermosillo",
      hours: "L-S 10-19",
    });
  });
  it("acepta solo uno de los dos", () => {
    expect(pickupInfo({ address: "Calle 5" })).toEqual({ address: "Calle 5", hours: null });
    expect(pickupInfo({ hours: "10-19" })).toEqual({ address: null, hours: "10-19" });
  });
  it("devuelve null si no hay datos", () => {
    expect(pickupInfo(undefined)).toBeNull();
    expect(pickupInfo(null)).toBeNull();
    expect(pickupInfo({ address: "  ", hours: "" })).toBeNull();
  });
});

describe("orderPickupInfo", () => {
  const contact = { address: "Calle 5 #10, Hermosillo", hours: "L-S 10-19" };
  const paid = {
    status: "paid",
    payment_status: "paid",
    shipping: { type: "pickup" },
  };

  it("en un pedido con retiro en tienda devuelve dirección y horario", () => {
    expect(orderPickupInfo(paid, contact)).toEqual(contact);
    expect(orderPickupInfo({ ...paid, status: "pending_payment" }, contact)).toEqual(contact);
    expect(orderPickupInfo(paid, { address: "Calle 5" })).toEqual({
      address: "Calle 5",
      hours: null,
    });
  });

  it("sin dirección declarada no muestra nada, aunque haya horario", () => {
    expect(orderPickupInfo(paid, { hours: "L-S 10-19" })).toBeNull();
    expect(orderPickupInfo(paid, { address: " ", hours: "L-S 10-19" })).toBeNull();
    expect(orderPickupInfo(paid, undefined)).toBeNull();
  });

  it("si la forma de envío del pedido no es retiro, no aplica", () => {
    expect(orderPickupInfo({ ...paid, shipping: { type: "flat" } }, contact)).toBeNull();
    expect(orderPickupInfo({ ...paid, shipping: {} }, contact)).toBeNull();
    expect(orderPickupInfo({ ...paid, shipping: null }, contact)).toBeNull();
  });

  it("en pedidos cancelados, completados o reembolsados ya no se indica dónde recoger", () => {
    expect(orderPickupInfo({ ...paid, status: "cancelled" }, contact)).toBeNull();
    expect(orderPickupInfo({ ...paid, status: "completed" }, contact)).toBeNull();
    expect(orderPickupInfo({ ...paid, payment_status: "refunded" }, contact)).toBeNull();
  });
});
