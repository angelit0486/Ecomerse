import { describe, expect, it } from "vitest";

import { ordersEmptyCopy } from "./empty-copy";

describe("ordersEmptyCopy", () => {
  it("«Todos» sin pedidos: la tienda aún no tiene ninguno", () => {
    expect(ordersEmptyCopy("todos", "Todos", false)).toEqual({
      title: "Sin pedidos",
      description: "Los pedidos de tu tienda aparecerán aquí.",
      showAll: false,
    });
  });

  it("«Por surtir» conserva su mensaje propio", () => {
    const copy = ordersEmptyCopy("por-surtir", "Por surtir", false);
    expect(copy.title).toBe("Nada por surtir");
    expect(copy.showAll).toBe(false);
  });

  it.each([
    ["cancelados", "Cancelados"],
    ["atencion", "Requieren atención"],
    ["pendientes", "Pendientes de pago"],
    ["pagados", "Pagados"],
  ])("con el filtro %s no dice «Sin pedidos» y ofrece ver todos", (filter, label) => {
    const copy = ordersEmptyCopy(filter, label, false);
    expect(copy.title).toBe("Nada en esta vista");
    expect(copy.description).toBe(`No hay pedidos en «${label}».`);
    expect(copy.showAll).toBe(true);
  });

  it("después de la última página tampoco dice «Sin pedidos»", () => {
    const copy = ordersEmptyCopy("todos", "Todos", true);
    expect(copy.title).toBe("Nada en esta vista");
    expect(copy.showAll).toBe(true);
  });
});
