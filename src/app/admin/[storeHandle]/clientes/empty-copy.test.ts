import { describe, expect, it } from "vitest";

import { customersEmptyCopy } from "./empty-copy";

describe("customersEmptyCopy", () => {
  it("sin búsqueda: la tienda aún no tiene clientes", () => {
    expect(customersEmptyCopy("")).toEqual({
      title: "Sin clientes",
      description: "Aparecen cuando alguien compra en tu tienda.",
    });
    expect(customersEmptyCopy("   ").title).toBe("Sin clientes");
  });

  it("con búsqueda: dice que no hay coincidencias e incluye lo buscado", () => {
    const copy = customersEmptyCopy("ana");
    expect(copy.title).toBe("Sin resultados");
    expect(copy.description).toContain("«ana»");
    expect(copy.description).not.toContain("Aparecen cuando alguien compra");
  });
});
