import { beforeEach, describe, expect, it, vi } from "vitest";

type CountResult = { count: number | null; error: unknown };

const results: Record<string, CountResult> = {};

/** Consulta encadenable de supabase-js: cada método devuelve la misma consulta. */
function query(table: string) {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    then: (resolve: (r: CountResult) => unknown) =>
      Promise.resolve(results[table] ?? { count: 0, error: null }).then(resolve),
  };
  return q;
}

vi.mock("./action-state", () => ({
  storeClient: vi.fn(async () => ({
    ctx: { store: { handle: "mi-tienda" } },
    supabase: { from: (table: string) => query(table) },
    storeId: "store-1",
  })),
}));
vi.mock("@/server/auth/context", () => ({ hasPermission: () => true }));
vi.mock("@/server/actions/report", () => ({ reportActionError: vi.fn() }));
vi.mock("@/server/system/health", () => ({ configIssues: () => [] }));

const { panelNotices } = await import("./notice-actions");

beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key];
});

describe("panelNotices", () => {
  it("una consulta con error devuelve null, no una lista vacía", async () => {
    results.orders = { count: null, error: { code: "57014", message: "timeout" } };
    await expect(panelNotices("mi-tienda")).resolves.toBeNull();
  });

  it("si falla la de opiniones también devuelve null", async () => {
    results.product_reviews = { count: null, error: { code: "PGRST000", message: "x" } };
    await expect(panelNotices("mi-tienda")).resolves.toBeNull();
  });

  it("con conteos válidos arma los avisos", async () => {
    results.orders = { count: 2, error: null };
    results.product_reviews = { count: 1, error: null };
    const notices = await panelNotices("mi-tienda");
    expect(notices?.map((n) => n.label)).toEqual([
      "2 pedidos requieren atención",
      "2 pedidos por surtir",
      "1 opinión por revisar",
    ]);
    expect(notices?.[0]).toMatchObject({
      urgent: true,
      href: "/admin/mi-tienda/pedidos?estado=atencion",
    });
  });

  it("todo en cero (sin error) es una lista vacía real", async () => {
    await expect(panelNotices("mi-tienda")).resolves.toEqual([]);
  });
});
