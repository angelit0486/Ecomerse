import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { hasPermission, parseStoreContext, requirePermission } from "./context";

const raw = {
  user_id: "0190a0d0-0000-7000-8000-000000000001",
  store: {
    id: "0190a0d0-0000-7000-8000-000000000002",
    organization_id: "0190a0d0-0000-7000-8000-000000000003",
    name: "Tienda A",
    handle: "tienda-a",
    status: "draft",
    currency: "MXN",
    locale: "es-MX",
    timezone: "America/Mexico_City",
  },
  org_role: null,
  access_mode: "full",
  support_grant_id: null,
  permissions: ["products.read", "products.update", "permiso.del.futuro"],
};

describe("parseStoreContext", () => {
  it("expone el contexto tipado", () => {
    const ctx = parseStoreContext(raw);
    expect(ctx.store.handle).toBe("tienda-a");
    expect(hasPermission(ctx, "products.update")).toBe(true);
    expect(hasPermission(ctx, "staff.manage")).toBe(false);
  });

  it("ignora permisos que el código no conoce (denegado por defecto)", () => {
    expect([...parseStoreContext(raw).permissions]).toEqual(["products.read", "products.update"]);
  });

  it("una respuesta con forma inesperada es internal", () => {
    expect(() => parseStoreContext({ ...raw, access_mode: "god_mode" })).toThrow(AppError);
  });

  it("requirePermission lanza forbidden", () => {
    const ctx = parseStoreContext(raw);
    expect(() => requirePermission(ctx, "products.read")).not.toThrow();
    try {
      requirePermission(ctx, "staff.manage");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("forbidden");
    }
  });
});
