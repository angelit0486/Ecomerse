import { describe, expect, it } from "vitest";

import { toAppError } from "@/server/db/errors";

import { newStoreErrorState } from "./errors";

const values = { store_name: "Mi tienda", store_handle: "mi-tienda" };
const db = (message: string, details?: string) =>
  toAppError({ code: "P0001", message, ...(details ? { details } : {}) });

describe("crear otra tienda: mensajes claros (revisión 2026-11-10)", () => {
  it("sin dominio de tiendas en la plataforma, dice qué falta (no «dirección repetida»)", () => {
    const state = newStoreErrorState(
      db("platform_not_configured", "platform_settings.storefront.root_domain"),
      values,
    );
    expect(state.error).toContain("falta configurar el dominio de las tiendas");
    expect(state.fields).toBeUndefined();
  });

  it("una dirección repetida se marca en su campo", () => {
    const state = newStoreErrorState(db("conflict", "handle"), values);
    expect(state.error).toBe("Ya existe una tienda con esa dirección.");
    expect(state.fields?.store_handle).toContain("Ya existe");
  });

  it("el límite del plan y el permiso dicen qué pasa", () => {
    expect(newStoreErrorState(db("limit_reached"), values).error).toContain("Tu plan");
    expect(
      newStoreErrorState(toAppError({ code: "42501", message: "forbidden" }), values).error,
    ).toContain("Tu rol");
  });
});
