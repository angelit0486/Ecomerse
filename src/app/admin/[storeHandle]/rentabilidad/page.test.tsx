// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/money/format";
import type { ProfitReport } from "@/lib/profit/report";

const mocks = vi.hoisted(() => ({
  report: null as unknown,
  permissions: new Set<string>(),
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
    store: { id: "s1", handle: "tienda", currency: "MXN" },
    orgRole: null,
    accessMode: "full",
    supportGrantId: null,
    permissions: mocks.permissions,
  }),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/db/rpc", () => ({ callRpc: async () => mocks.report }));
vi.mock("../_shared/panel-flags", () => ({ panelFlagEnabled: async () => true }));

import ProfitPage from "./page";

const READER = ["analytics.read", "products.cost.read", "orders.read"];
const EDITOR = [...READER, "products.read", "products.update"];

const base: ProfitReport = {
  from: "2026-03-01",
  to: "2026-03-30",
  orders: 2,
  cancelled_orders: 0,
  revenue: 100000,
  revenue_without_cost: 0,
  cost: 40000,
  other_refunds: 0,
  profit: 60000,
  units_without_cost: 0,
  units_current_cost: 0,
  shipping_charged: 0,
  tax: 0,
  products: [],
  order_rows: [
    {
      order_id: "0191f3a0-0000-7000-8000-000000000001",
      number: "#1001",
      paid_at: "2026-03-10T18:00:00+00:00",
      revenue: 100000,
      cost: 40000,
      other_refunds: 0,
      profit: 60000,
    },
  ],
};

const m = (cents: number) => formatMoney(cents, "MXN");

async function renderPage(report: ProfitReport, permissions = EDITOR) {
  mocks.report = report;
  mocks.permissions = new Set(permissions);
  const ui = await ProfitPage({
    params: Promise.resolve({ storeHandle: "tienda" }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

/** Tarjeta de resumen por su título (`<dt>`), o null si no está. */
function card(title: string): HTMLElement | null {
  const dt = screen.queryAllByText(title, { selector: "dt" })[0];
  return dt ? dt.parentElement : null;
}

function orderRow(number: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(number) });
}

beforeEach(() => {
  mocks.report = null;
});
afterEach(cleanup);

describe("Rentabilidad sin costos capturados", () => {
  const none: ProfitReport = {
    ...base,
    revenue: 100000,
    revenue_without_cost: 100000,
    cost: 0,
    other_refunds: 5000,
    profit: -5000,
    units_without_cost: 4,
    order_rows: [{ ...base.order_rows[0]!, cost: 0, other_refunds: 5000, profit: null }],
  };

  it("no muestra Utilidad ni Margen como tarjeta; sí el aviso y la venta", async () => {
    await renderPage(none);
    expect(card("Utilidad")).toBeNull();
    expect(card("Margen")).toBeNull();
    expect(card("Costo de lo vendido")).toBeNull();
    expect(card("Venta de productos")!.textContent).toContain(m(100000));
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Todavía no se puede calcular tu utilidad/);
    expect(status.textContent).toMatch(/Ningún producto vendido/);
    // Ni utilidad en $0 ni negativa por reembolsos en ninguna parte de la cuenta.
    const como = screen.getByRole("region", { name: "Cómo sale la cuenta" });
    expect(como.textContent).not.toContain(m(-5000));
    expect(como.textContent).not.toContain(m(0));
    expect(within(como).queryByText("Utilidad")).toBeNull();
  });

  it("con permiso de editar productos enlaza a la lista; sin él, solo el texto", async () => {
    await renderPage(none);
    const link = within(screen.getByRole("status")).getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/tienda/productos");
    cleanup();
    await renderPage(none, READER);
    expect(within(screen.getByRole("status")).queryByRole("link")).toBeNull();
  });

  it("pedido sin costo: la columna Costo dice «Sin costo», no $0", async () => {
    await renderPage(none);
    const row = orderRow("#1001");
    expect(row.textContent).toContain("Sin costo");
    expect(row.textContent).not.toContain(m(0));
  });
});

describe("Rentabilidad con costos parciales", () => {
  const partial: ProfitReport = {
    ...base,
    revenue: 100000,
    revenue_without_cost: 38000,
    cost: 30000,
    profit: 32000,
    units_without_cost: 3,
    order_rows: [
      { ...base.order_rows[0]!, cost: 30000, profit: null },
      {
        ...base.order_rows[0]!,
        order_id: "0191f3a0-0000-7000-8000-000000000002",
        number: "#1002",
        cost: 0,
        profit: null,
      },
    ],
  };

  it("la tarjeta Utilidad dice qué porcentaje de la venta cubre", async () => {
    await renderPage(partial);
    const utilidad = card("Utilidad")!;
    expect(utilidad.textContent).toContain(m(32000));
    expect(utilidad.textContent).toContain(
      "Calculada sobre el 62 % de tus ventas; el resto no tiene costo.",
    );
  });

  it("el aviso de unidades sin costo sube arriba de las tarjetas", async () => {
    await renderPage(partial);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("3 unidades vendidas no tienen costo capturado");
    const cards = card("Utilidad")!;
    // El aviso va antes que las tarjetas en el documento…
    expect(status.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …y no se repite en la lista gris del final.
    expect(screen.getAllByText(/3 unidades vendidas no tienen costo/)).toHaveLength(1);
  });

  it("pedido con costo parcial dice «Incompleto»; sin costo, «Sin costo»", async () => {
    await renderPage(partial);
    expect(orderRow("#1001").textContent).toContain("Incompleto");
    expect(orderRow("#1001").textContent).not.toContain(m(30000));
    expect(orderRow("#1002").textContent).toContain("Sin costo");
  });
});

describe("Rentabilidad con todos los costos", () => {
  it("queda igual: utilidad, margen y costo por pedido normales, sin aviso", async () => {
    await renderPage(base);
    expect(card("Utilidad")!.textContent).toBe(`Utilidad${m(60000)}`);
    expect(card("Margen")!.textContent).toContain("60.0 %");
    expect(card("Costo de lo vendido")!.textContent).toContain(m(40000));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Calculada sobre el/)).toBeNull();
    expect(orderRow("#1001").textContent).toContain(m(40000));
  });
});
