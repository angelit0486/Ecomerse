import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSuggestions = vi.fn();
vi.mock("@/server/storefront/cart", () => ({ clientIpHash: async () => "iphash" }));
vi.mock("@/server/storefront/catalog", () => ({
  mediaUrl: (p: string) => `https://media/${p}`,
  searchSuggestions: (...args: unknown[]) => searchSuggestions(...args),
}));
vi.mock("@/server/storefront/context", () => ({
  storefrontForRoute: async () => ({
    store: { id: "store-1", currency: "MXN", locale: "es-MX" },
    preview: false,
  }),
}));
vi.mock("../../_components/format", () => ({ money: (n: number) => `$${n}` }));

import { GET } from "./route";

const EMPTY = { products: [], values: [], categories: [], brands: [] };
const call = () =>
  GET(new Request("https://tienda.test/buscar/sugerencias?q=ca"), {
    params: Promise.resolve({ storeId: "store-1" }),
  });

describe("sugerencias: freno por instancia", () => {
  beforeEach(() => searchSuggestions.mockReset());

  it("mientras una consulta sigue en curso, otra recibe 429 con la lista vacía sin tocar la base", async () => {
    let finish!: (v: typeof EMPTY) => void;
    searchSuggestions.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const first = call();
    await vi.waitFor(() => expect(searchSuggestions).toHaveBeenCalledOnce());
    const second = await call();
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ items: [] });
    expect(searchSuggestions).toHaveBeenCalledOnce();
    finish(EMPTY);
    expect((await first).status).toBe(200);
  });

  it("libera el turno aunque la consulta falle", async () => {
    searchSuggestions.mockRejectedValueOnce(new Error("db"));
    await expect(call()).rejects.toThrow("db");
    searchSuggestions.mockResolvedValueOnce(EMPTY);
    expect((await call()).status).toBe(200);
  });
});
