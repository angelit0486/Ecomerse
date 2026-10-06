import { describe, expect, it, vi } from "vitest";

const rows: { store: unknown }[] = [];
vi.mock("@/server/db/role-clients", () => ({
  gatewayDb: () => async () => rows,
}));

const { getStorePublic } = await import("./store-public");

const base = {
  id: "0190a0d0-0000-7000-8000-000000000001",
  name: "Tienda",
  handle: "tienda",
  status: "active",
  locale: "es-MX",
  currency: "MXN",
  country: "MX",
  logo: null,
};

describe("getStorePublic", () => {
  it("una tienda sin fila de tema se sirve con los defaults", async () => {
    rows.splice(0, rows.length, {
      store: { ...base, theme: { key: null, version: null, settings: {} } },
    });
    expect(await getStorePublic(base.id)).toMatchObject({ name: "Tienda", theme: { key: null } });
  });
});
