// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReplenishmentRow } from "@/lib/inventory/replenishment";
import type { ReplenishmentResult } from "@/server/inventory/replenishment";

const mocks = vi.hoisted(() => ({
  result: null as unknown,
  permissions: new Set<string>(),
  load: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/auth/store-context-page", () => ({
  getStoreContextForPage: async () => ({
    userId: "u1",
    store: { id: "s1", handle: "tienda", currency: "MXN", timezone: "America/Hermosillo" },
    orgRole: null,
    accessMode: "full",
    supportGrantId: null,
    permissions: mocks.permissions,
  }),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/inventory/replenishment", () => ({
  STOCK_CAP: 2000,
  loadReplenishment: (...args: unknown[]) => {
    mocks.load(...args);
    return Promise.resolve(mocks.result);
  },
}));

import ReplenishmentPage from "./page";

const ALL = ["inventory.read", "products.read", "orders.read", "products.cost.read"];

const row = (over: Partial<ReplenishmentRow> = {}): ReplenishmentRow => ({
  variantId: "0191f3a0-0000-7000-8000-0000000000a1",
  productId: "0191f3a0-0000-7000-8000-0000000000p1",
  productTitle: "Café molido",
  optionSignature: "Tamaño=1 kg",
  sku: "CAF-1",
  available: 4,
  lowStockThreshold: 5,
  lowStock: true,
  unitsSold: 45,
  coverageDays: 2,
  targetDays: 17,
  suggestedQuantity: 22,
  quantityBasis: "sales",
  supplier: { id: "s1", name: "Tostadores del Norte", leadDays: 10 },
  ...over,
});

type Loaded = Extract<ReplenishmentResult, { ok: true }>;

const ok = (over: Partial<Loaded> = {}): ReplenishmentResult => ({
  ok: true,
  rows: [row()],
  window: { from: "2026-10-18", to: "2026-11-16" },
  stockCount: 12,
  stockTruncated: false,
  salesIncluded: true,
  salesTruncated: false,
  suppliersIncluded: true,
  suppliersTruncated: false,
  ...over,
});

async function renderPage(result: ReplenishmentResult, permissions = ALL) {
  mocks.result = result;
  mocks.permissions = new Set(permissions);
  mocks.load.mockClear();
  const ui = await ReplenishmentPage({ params: Promise.resolve({ storeHandle: "tienda" }) });
  return render(ui);
}

const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

afterEach(cleanup);

describe("Qué pedir", () => {
  it("sin inventory.read es 404", async () => {
    const page = renderPage(ok(), ["products.read", "orders.read"]);
    await expect(page).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("explica el cálculo (30 días, +7, 30 sin plazo) y que no es un pedido", async () => {
    await renderPage(ok());
    expect(screen.getByRole("heading", { level: 1, name: "Qué pedir" })).toBeTruthy();
    expect(screen.getByText(/últimos 30 días \(según la zona horaria de tu tienda\)/)).toBeTruthy();
    expect(screen.getByText(/más 7 días de margen, o para 30 días/)).toBeTruthy();
    expect(screen.getByText(/PRUVA no envía pedidos a tus proveedores/)).toBeTruthy();
    expect(mocks.load).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        storeId: "s1",
        timeZone: "America/Hermosillo",
        canReadOrders: true,
        canReadSuppliers: true,
      }),
    );
  });

  it("con ítems muestra cantidad, cobertura, proveedor y enlaces; sin botones", async () => {
    await renderPage(
      ok({
        rows: [
          row(),
          row({
            variantId: "0191f3a0-0000-7000-8000-0000000000a2",
            productTitle: "Té verde",
            optionSignature: "",
            sku: null,
            available: 1,
            unitsSold: 0,
            coverageDays: null,
            suggestedQuantity: null,
            quantityBasis: null,
            targetDays: 30,
            supplier: null,
          }),
        ],
      }),
    );
    const table = screen.getByRole("table");
    const [, firstRow, secondRow] = within(table).getAllByRole("row");
    const first = within(firstRow!);
    expect(first.getByText("22")).toBeTruthy();
    expect(first.getByText("Para 17 días")).toBeTruthy();
    expect(first.getByText("2 días")).toBeTruthy();
    expect(first.getByText("45")).toBeTruthy();
    expect(first.getByText("Tostadores del Norte")).toBeTruthy();
    expect(first.getByText("Entrega en 10 días")).toBeTruthy();
    expect(first.getByText("1 kg")).toBeTruthy();
    const history = first.getByRole("link", { name: "Historial de Café molido · 1 kg" });
    expect(history.getAttribute("href")).toBe(
      "/admin/tienda/inventario/0191f3a0-0000-7000-8000-0000000000a1",
    );
    const product = first.getByRole("link", { name: "Café molido" });
    expect(product.getAttribute("href")).toBe(
      "/admin/tienda/productos/0191f3a0-0000-7000-8000-0000000000p1",
    );
    // Sin ventas: ni 0 ni número inventado como sugerencia.
    const second = within(secondRow!);
    expect(second.getByText("Sin ventas en 30 días")).toBeTruthy();
    expect(second.getByText("Sin ventas recientes para estimar")).toBeTruthy();
    expect(second.getByText("Sin proveedor")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/orden de compra/i)).toBeNull();
  });

  it("vacío honesto: no parece error y enlaza a Inventario", async () => {
    await renderPage(ok({ rows: [] }));
    const text =
      "Con las ventas de los últimos 30 días y tu inventario, no hay nada urgente que pedir.";
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(hrefOf("Ver Inventario")).toBe("/admin/tienda/inventario");
  });

  it("sin inventario enlaza a Productos", async () => {
    await renderPage(ok({ rows: [], stockCount: 0 }));
    expect(screen.getByText("Aún no hay inventario que revisar")).toBeTruthy();
    expect(hrefOf("Ir a Productos")).toBe("/admin/tienda/productos");
    expect(screen.queryByText(/nada urgente/)).toBeNull();
  });

  it("error: se dice y ofrece reintentar; nunca «nada que pedir»", async () => {
    await renderPage({ ok: false });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("No pudimos calcular qué pedir")).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "Reintentar" })).toBeTruthy();
    expect(hrefOf("Reintentar")).toBe("/admin/tienda/inventario/reposicion");
    expect(screen.queryByText(/nada urgente/i)).toBeNull();
    expect(screen.queryByText(/Aún no hay inventario/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("sin orders.read: aviso, sin columnas de ventas ni sugerencias", async () => {
    await renderPage(
      ok({
        salesIncluded: false,
        suppliersIncluded: false,
        rows: [
          row({
            unitsSold: null,
            coverageDays: null,
            suggestedQuantity: null,
            quantityBasis: null,
            supplier: null,
          }),
        ],
      }),
      ["inventory.read", "products.read"],
    );
    expect(mocks.load).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ canReadOrders: false, canReadSuppliers: false }),
    );
    expect(screen.getByText(/No tienes permiso para ver pedidos/)).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /Cantidad a pedir/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Vendidas/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Proveedor" })).toBeNull();
    expect(screen.getByText("Café molido")).toBeTruthy();
    expect(screen.getByText("Stock bajo")).toBeTruthy();
  });

  it("sin orders.read y nada en stock bajo: el vacío no habla de ventas", async () => {
    await renderPage(ok({ salesIncluded: false, rows: [] }), ["inventory.read", "products.read"]);
    const text = "Ninguna variante está en o por debajo de su aviso de stock bajo.";
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/ventas de los últimos/)).toBeNull();
  });

  it("sin products.read: estado sin permiso, sin cargar datos", async () => {
    await renderPage(ok(), ["inventory.read", "orders.read"]);
    expect(screen.getByText("No tienes permiso para ver productos")).toBeTruthy();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("declara recortes de variantes y de ventas", async () => {
    await renderPage(ok({ stockTruncated: true, salesTruncated: true, suppliersTruncated: true }));
    const notices = screen.getByRole("list", { name: "Avisos del cálculo" });
    expect(within(notices).getByText(/Se calcularon las primeras 2.?000 variantes/)).toBeTruthy();
    expect(within(notices).getByText(/El cálculo está incompleto/)).toBeTruthy();
    expect(within(notices).getByText(/No pudimos leer todos los proveedores/)).toBeTruthy();
  });

  it("recorte con cero variantes leídas no se presenta como «sin inventario»", async () => {
    await renderPage(ok({ rows: [], stockCount: 0, stockTruncated: true }));
    expect(screen.queryByText("Aún no hay inventario que revisar")).toBeNull();
  });

  it("stock bajo con ventas lentas: pide lo que lo saca del aviso, nunca 0", async () => {
    await renderPage(
      ok({
        rows: [
          row({
            available: 3,
            lowStockThreshold: 5,
            unitsSold: 1,
            coverageDays: 90,
            targetDays: 30,
            suggestedQuantity: 3,
            quantityBasis: "threshold",
          }),
        ],
      }),
    );
    const [, first] = within(screen.getByRole("table")).getAllByRole("row");
    const cells = within(first!);
    expect(cells.getByText("Stock bajo")).toBeTruthy();
    expect(cells.getByText("3", { selector: "span.font-semibold" })).toBeTruthy();
    expect(cells.getByText("Para salir del stock bajo (aviso en 5)")).toBeTruthy();
    expect(cells.queryByText(/^Te alcanza para/)).toBeNull();
  });
});
