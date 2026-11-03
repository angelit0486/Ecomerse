import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/role-clients", () => ({ gatewayDb: () => null }));

const { readStoreFlags } = await import("./flags");

describe("readStoreFlags", () => {
  it("solo los encendidos", async () => {
    const flags = await readStoreFlags(async () => [
      { key: "storefront_nav_scroll_fix", enabled: true },
      { key: "otro", enabled: false },
    ]);
    expect([...flags]).toEqual(["storefront_nav_scroll_fix"]);
  });

  it("si la función o la tabla no existen (base anterior), todo apagado", async () => {
    const missing = Object.assign(new Error("function storefront.get_store_flags does not exist"), {
      code: "42883",
    });
    const flags = await readStoreFlags(() => Promise.reject(missing));
    expect(flags.size).toBe(0);
  });

  it("si la base no responde, todo apagado (la tienda queda como antes)", async () => {
    const flags = await readStoreFlags(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(flags.size).toBe(0);
  });
});
