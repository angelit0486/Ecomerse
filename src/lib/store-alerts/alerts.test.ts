import { describe, expect, it } from "vitest";

import { buildStoreAlerts, storeAlertsSchema } from "./alerts";

const base = "/admin/mi-tienda";

describe("buildStoreAlerts", () => {
  it("sin pendientes no hay alertas", () => {
    expect(
      buildStoreAlerts(
        { out_of_stock: 0, low_stock: 0, without_photo: 0, without_category: 0 },
        base,
      ),
    ).toEqual([]);
  });

  it("ordena por urgencia y enlaza a la lista filtrada de productos publicados", () => {
    const alerts = buildStoreAlerts(
      { out_of_stock: 3, low_stock: 1, without_photo: 1200, without_category: 7 },
      base,
    );
    expect(alerts.map((a) => [a.key, a.level, a.count])).toEqual([
      ["agotados", "alta", 3],
      ["sin_foto", "media", 1200],
      ["pocas_existencias", "media", 1],
      ["sin_categoria", "baja", 7],
    ]);
    expect(alerts[0]!.href).toBe("/admin/mi-tienda/productos?estado=active&pendiente=agotados");
    expect(alerts[1]!.description).toMatch(/^1,200 productos publicados se ven/);
    expect(alerts[2]!.description).toBe(
      "1 producto publicado en su mínimo de existencias o por debajo.",
    );
    for (const a of alerts) {
      expect(a.title).not.toBe("");
      expect(a.action).not.toBe("");
    }
  });

  it("sin permiso de inventario (null) no inventa alertas de existencias", () => {
    const alerts = buildStoreAlerts(
      { out_of_stock: null, low_stock: null, without_photo: 2, without_category: 0 },
      base,
    );
    expect(alerts.map((a) => a.key)).toEqual(["sin_foto"]);
  });

  it("el esquema rechaza conteos negativos o faltantes", () => {
    expect(
      storeAlertsSchema.safeParse({
        out_of_stock: -1,
        low_stock: 0,
        without_photo: 0,
        without_category: 0,
      }).success,
    ).toBe(false);
    expect(storeAlertsSchema.safeParse({ out_of_stock: 0 }).success).toBe(false);
  });
});
