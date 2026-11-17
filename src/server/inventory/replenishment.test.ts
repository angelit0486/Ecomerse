import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCapped, loadReplenishment, PAGE_SIZE, STOCK_CAP } from "./replenishment";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/server/observability/logger", () => ({ log: { warn } }));

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Handler = (q: { filters: unknown[][]; range: [number, number] | null }) => Result;

/** Cliente falso: registra la cadena de filtros y responde por tabla. */
function fakeClient(handlers: Record<string, Handler>) {
  const calls: { table: string; filters: unknown[][]; range: [number, number] | null }[] = [];
  const client = {
    from(table: string) {
      const q = { filters: [] as unknown[][], range: null as [number, number] | null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "gte", "lt", "neq", "in", "order"]) {
        builder[m] = (...args: unknown[]) => {
          q.filters.push([m, ...args]);
          return builder;
        };
      }
      builder.range = (from: number, to: number) => {
        q.range = [from, to];
        return builder;
      };
      const run = () => {
        calls.push({ table, ...q });
        const h = handlers[table];
        if (!h) throw new Error(`tabla inesperada: ${table}`);
        return h(q);
      };
      const settle = () => Promise.resolve().then(run);
      builder.maybeSingle = settle;
      builder.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        settle().then(res, rej);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/** Responde con la porción pedida por `range`, como PostgREST. */
function slice<T>(rows: T[]): Handler {
  return ({ range }) => ({
    data: range ? rows.slice(range[0], range[1] + 1) : rows,
    error: null,
  });
}

const level = (variantId: string, available: number, threshold: number | null = null) => ({
  variant_id: variantId,
  available,
  low_stock_threshold: threshold,
  product_variants: {
    sku: `SKU-${variantId}`,
    option_signature: "",
    track_inventory: true,
    product_id: `p-${variantId}`,
    products: { title: `Producto ${variantId}` },
  },
});

const NOW = new Date("2026-11-16T18:00:00Z");
const base = { storeId: "s1", timeZone: "America/Mexico_City", now: NOW };
const location: Handler = () => ({ data: { id: "loc1" }, error: null });

beforeEach(() => warn.mockReset());

describe("fetchCapped", () => {
  it("pagina de PAGE_SIZE en PAGE_SIZE y se detiene con una página vacía", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const ranges: [number, number][] = [];
    const out = await fetchCapped<number>(
      "x",
      (from, to) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      5000,
    );
    expect(out).toEqual({ rows, truncated: false });
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
  });

  it("si el servidor devuelve menos filas por página (max_rows menor), sigue leyendo", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => i);
    const out = await fetchCapped<number>(
      "x",
      // Responde como mucho 500 filas aunque se pidan 1000.
      (from) => Promise.resolve({ data: rows.slice(from, from + 500), error: null }),
      5000,
    );
    expect(out.rows).toHaveLength(1200);
    expect(out.truncated).toBe(false);
  });

  it("recorta al tope y lo declara (pide una fila de más para saberlo)", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    const out = await fetchCapped<number>(
      "x",
      (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      10,
    );
    expect(out.rows).toEqual(rows.slice(0, 10));
    expect(out.truncated).toBe(true);
  });

  it("exactamente el tope no es recorte", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const out = await fetchCapped<number>(
      "x",
      (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      10,
    );
    expect(out).toEqual({ rows, truncated: false });
  });
});

describe("loadReplenishment", () => {
  it("lee la ubicación principal, con seguimiento y pedidos cobrados en la ventana", async () => {
    const { client, calls } = fakeClient({
      inventory_locations: location,
      inventory_levels: slice([level("a", 0), level("b", 50)]),
      order_items: slice([
        {
          variant_id: "a",
          quantity: 3,
          refunded_quantity: 0,
          orders: { status: "open", payment_status: "paid", paid_at: "2026-11-10T18:00:00Z" },
        },
      ]),
      supplier_variants: slice([]),
    });
    const res = await loadReplenishment(client, {
      ...base,
      canReadOrders: true,
      canReadSuppliers: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => [r.variantId, r.unitsSold, r.suggestedQuantity])).toEqual([
      ["a", 3, 3],
    ]);
    expect(res).toMatchObject({
      window: { from: "2026-10-18", to: "2026-11-16" },
      stockCount: 2,
      stockTruncated: false,
      salesIncluded: true,
      salesTruncated: false,
      suppliersIncluded: true,
    });

    const levels = calls.find((c) => c.table === "inventory_levels")!;
    expect(levels.filters).toContainEqual(["eq", "location_id", "loc1"]);
    expect(levels.filters).toContainEqual(["eq", "product_variants.track_inventory", true]);
    expect(levels.filters).toContainEqual(["is", "product_variants.deleted_at", null]);
    expect(levels.filters).toContainEqual(["is", "product_variants.products.deleted_at", null]);

    const items = calls.find((c) => c.table === "order_items")!;
    expect(items.filters).toContainEqual(["eq", "store_id", "s1"]);
    expect(items.filters).toContainEqual(["gte", "orders.paid_at", "2026-10-18T06:00:00.000Z"]);
    expect(items.filters).toContainEqual(["lt", "orders.paid_at", "2026-11-17T06:00:00.000Z"]);
    expect(items.filters).toContainEqual(["neq", "orders.status", "cancelled"]);
    expect(items.filters).toContainEqual([
      "in",
      "orders.payment_status",
      ["paid", "partially_refunded"],
    ]);
  });

  it("sin orders.read no consulta pedidos y solo aplica la regla de stock bajo", async () => {
    const { client, calls } = fakeClient({
      inventory_locations: location,
      inventory_levels: slice([level("a", 2, 5), level("b", 1)]),
    });
    const res = await loadReplenishment(client, {
      ...base,
      canReadOrders: false,
      canReadSuppliers: false,
    });
    expect(calls.some((c) => c.table === "order_items")).toBe(false);
    expect(calls.some((c) => c.table === "supplier_variants")).toBe(false);
    expect(res).toMatchObject({ ok: true, salesIncluded: false, suppliersIncluded: false });
    if (!res.ok) return;
    expect(res.rows.map((r) => [r.variantId, r.suggestedQuantity, r.unitsSold])).toEqual([
      ["a", null, null],
    ]);
  });

  it("toma el proveedor activo de menor plazo y alarga el horizonte", async () => {
    const { client } = fakeClient({
      inventory_locations: location,
      inventory_levels: slice([level("a", 0)]),
      order_items: slice([
        {
          variant_id: "a",
          quantity: 30,
          refunded_quantity: 0,
          orders: { status: "open", payment_status: "paid", paid_at: "2026-11-10T18:00:00Z" },
        },
      ]),
      supplier_variants: slice([
        {
          variant_id: "a",
          suppliers: {
            id: "s2",
            name: "Lento",
            status: "active",
            lead_time_min_days: 10,
            lead_time_max_days: 20,
          },
        },
        {
          variant_id: "a",
          suppliers: {
            id: "s1",
            name: "Rápido",
            status: "active",
            lead_time_min_days: null,
            lead_time_max_days: 3,
          },
        },
      ]),
    });
    const res = await loadReplenishment(client, {
      ...base,
      canReadOrders: true,
      canReadSuppliers: true,
    });
    if (!res.ok) throw new Error("debía cargar");
    expect(res.rows[0]).toMatchObject({
      supplier: { name: "Rápido", leadDays: 3 },
      targetDays: 10,
      suggestedQuantity: 10,
    });
  });

  it("declara el recorte de variantes", async () => {
    const many = Array.from({ length: STOCK_CAP + 5 }, (_, i) => level(`v${i}`, 100));
    const { client } = fakeClient({
      inventory_locations: location,
      inventory_levels: slice(many),
    });
    const res = await loadReplenishment(client, {
      ...base,
      canReadOrders: false,
      canReadSuppliers: false,
    });
    expect(res).toMatchObject({ ok: true, stockCount: STOCK_CAP, stockTruncated: true });
  });

  it.each(["inventory_levels", "order_items", "supplier_variants"])(
    "si falla %s devuelve error, nunca una lista vacía",
    async (table) => {
      const failing: Handler = () => ({ data: null, error: { message: "boom", code: "XX000" } });
      const { client } = fakeClient({
        inventory_locations: location,
        inventory_levels: slice([level("a", 0)]),
        order_items: slice([]),
        supplier_variants: slice([]),
        [table]: failing,
      });
      const res = await loadReplenishment(client, {
        ...base,
        canReadOrders: true,
        canReadSuppliers: true,
      });
      expect(res).toEqual({ ok: false });
      expect(warn).toHaveBeenCalledWith(
        "replenishment_load_failed",
        expect.objectContaining({ step: table, code: "XX000" }),
      );
    },
  );

  it("sin ubicación principal es un error, no un vacío", async () => {
    const { client } = fakeClient({
      inventory_locations: () => ({ data: null, error: null }),
    });
    const res = await loadReplenishment(client, {
      ...base,
      canReadOrders: true,
      canReadSuppliers: false,
    });
    expect(res).toEqual({ ok: false });
  });
});
