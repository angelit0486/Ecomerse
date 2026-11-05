import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeCheck, sortChecks, storeHealthSchema, type HealthCheck } from "./checks";

const PANEL = join(process.cwd(), "src/app/admin/[storeHandle]");
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261105000700_store_health.sql"),
  "utf8",
);
const KEYS = [
  "notifications",
  "payments",
  "shipping",
  "products_without_photo",
  "out_of_stock",
  "policies",
  "plan_max_products",
  "plan_max_staff",
  "plan_storage_mb",
  "orders_waiting",
  "orders_attention",
];

describe("salud de tu tienda (paso 19)", () => {
  it("cada revisión de la base tiene texto y lleva a una pantalla que existe", () => {
    for (const key of KEYS) {
      const bare = key.startsWith("plan_") ? key.slice(5) : key;
      expect(migration, key).toContain(`'${bare}'`);
      for (const status of ["ok", "warning", "critical"] as const) {
        const copy = describeCheck({
          key,
          status,
          value: 2,
          limit: 5,
          missing: ["policy_privacy"],
        });
        expect(copy.title, key).not.toBe(key);
        if (status !== "ok") expect(copy.detail, `${key} ${status}`).toBeTruthy();
        const route = copy.path.split("?")[0]!;
        expect(existsSync(join(PANEL, route, "page.tsx")), `${key} → ${route}`).toBe(true);
      }
    }
  });

  it("explica qué políticas faltan y que el aviso de privacidad es obligatorio", () => {
    const c = describeCheck({
      key: "policies",
      status: "critical",
      value: 2,
      missing: ["policy_privacy", "policy_terms"],
    });
    expect(c.detail).toBe(
      "Sin publicar: aviso de privacidad, términos y condiciones. El aviso de privacidad es obligatorio por ley.",
    );
  });

  it("singular y plural, y el uso del plan con su límite", () => {
    expect(
      describeCheck({ key: "products_without_photo", status: "warning", value: 1 }).title,
    ).toBe("1 producto sin foto");
    expect(describeCheck({ key: "out_of_stock", status: "warning", value: 3 }).title).toBe(
      "3 productos agotados",
    );
    expect(
      describeCheck({ key: "plan_max_products", status: "warning", value: 4, limit: 5 }).title,
    ).toBe("Usas 4 de 5 productos de tu plan");
  });

  it("ordena primero lo urgente y valida la respuesta de la base", () => {
    const checks: HealthCheck[] = [
      { key: "a", status: "ok", value: 0 },
      { key: "b", status: "critical", value: 0 },
      { key: "c", status: "warning", value: 0 },
    ];
    expect(sortChecks(checks).map((c) => c.key)).toEqual(["b", "c", "a"]);
    expect(
      storeHealthSchema.safeParse({ checked_at: "2026-11-05T00:00:00Z", status: "ok", checks })
        .success,
    ).toBe(true);
  });
});
