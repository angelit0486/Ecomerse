import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/role-clients", () => ({ gatewayDb: vi.fn() }));

import { EXPECTED_SCHEMA_VERSION } from "@/server/db/schema-version";

import { readStorefrontSchema } from "./schema";

describe("versión del esquema en la tienda", () => {
  it("al día: sigue normal", async () => {
    await expect(readStorefrontSchema(async () => EXPECTED_SCHEMA_VERSION)).resolves.toEqual({
      ok: true,
    });
  });

  it("versión anterior: avisa con la versión que tiene", async () => {
    await expect(readStorefrontSchema(async () => "20261025000100")).resolves.toEqual({
      ok: false,
      current: "20261025000100",
    });
  });

  it("la función aún no existe (42883): faltan migraciones", async () => {
    const missing = Object.assign(new Error("function does not exist"), { code: "42883" });
    await expect(
      readStorefrontSchema(async () => {
        throw missing;
      }),
    ).resolves.toEqual({ ok: false, current: null });
  });

  it("error de red: no se confunde con migraciones faltantes", async () => {
    const network = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    await expect(
      readStorefrontSchema(async () => {
        throw network;
      }),
    ).resolves.toEqual({ ok: true });
  });
});
