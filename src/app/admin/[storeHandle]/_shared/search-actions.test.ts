import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

let ordersResult: Result = { data: [], error: null };

/** Consulta encadenable de supabase-js: cada método devuelve la misma consulta. */
function query() {
  const q = {
    select: () => q,
    eq: () => q,
    ilike: () => q,
    order: () => q,
    limit: () => q,
    then: (resolve: (r: Result) => unknown) => Promise.resolve(ordersResult).then(resolve),
  };
  return q;
}

vi.mock("./action-state", () => ({
  storeClient: vi.fn(async () => ({
    ctx: { store: { handle: "mi-tienda" } },
    supabase: { from: () => query() },
    storeId: "store-1",
  })),
}));
// Solo pedidos: así la prueba no depende del catálogo ni de clientes.
vi.mock("@/server/auth/context", () => ({
  hasPermission: (_ctx: unknown, permission: string) => permission === "orders.read",
}));
vi.mock("@/server/actions/report", () => ({ reportActionError: vi.fn() }));
vi.mock("@/server/catalog/queries", () => ({ searchProducts: vi.fn() }));
vi.mock("@/server/db/rpc", () => ({ callRpc: vi.fn() }));

const { searchPanel } = await import("./search-actions");

beforeEach(() => {
  ordersResult = { data: [], error: null };
});

describe("searchPanel", () => {
  it("si la consulta de pedidos trae error devuelve null, no resultados vacíos", async () => {
    ordersResult = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(searchPanel("mi-tienda", "1001")).resolves.toBeNull();
  });

  it("sin coincidencias devuelve los grupos vacíos", async () => {
    await expect(searchPanel("mi-tienda", "1001")).resolves.toEqual({
      products: [],
      orders: [],
      customers: [],
    });
  });

  it("con un pedido arma su enlace", async () => {
    ordersResult = { data: [{ id: "o1", display_number: "#1001" }], error: null };
    const results = await searchPanel("mi-tienda", "1001");
    expect(results?.orders).toEqual([
      { href: "/admin/mi-tienda/pedidos/o1", label: "Pedido #1001", detail: "Pedido" },
    ]);
  });

  it("una búsqueda de menos de 2 letras no consulta y no es un error", async () => {
    await expect(searchPanel("mi-tienda", "a")).resolves.toEqual({
      products: [],
      orders: [],
      customers: [],
    });
  });
});
