// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  report: null as unknown,
  error: null as unknown,
  permissions: new Set<string>(),
  orgRole: "org_owner" as string | null,
  calls: [] as Record<string, unknown>[],
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
    orgRole: mocks.orgRole,
    accessMode: "full",
    supportGrantId: null,
    permissions: mocks.permissions,
  }),
}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/db/rpc", () => ({
  callRpc: async (_: unknown, __: string, args: Record<string, unknown>) => {
    mocks.calls.push(args);
    if (mocks.error) throw mocks.error;
    return mocks.report;
  },
}));

const { AppError } = await import("@/server/errors");
const { default: Page } = await import("./page");

const report = {
  from: "2026-10-27",
  to: "2026-11-25",
  currency: "MXN",
  rows: [
    {
      promotion_id: "a",
      name: "Playeras 3x2",
      label: "3×2 en playeras",
      type: "buy_n_pay_m",
      status: "active",
      orders: 4,
      units: 12,
      discount: 40000,
      sales: 80000,
    },
  ],
  totals: { orders: 4, discount: 40000, sales: 80000, paid_orders: 10 },
};

async function show(rango?: string) {
  render(
    await Page({
      params: Promise.resolve({ storeHandle: "tienda" }),
      searchParams: Promise.resolve(rango ? { rango } : {}),
    }),
  );
}

beforeEach(() => {
  mocks.report = report;
  mocks.error = null;
  mocks.permissions = new Set(["discounts.read"]);
  mocks.orgRole = "org_owner";
  mocks.calls = [];
});
afterEach(cleanup);

describe("reporte de promociones (fase 4)", () => {
  it("por promoción: pedidos, piezas, ahorro y venta, con totales", async () => {
    await show();
    const row = screen.getByRole("row", { name: /Playeras 3x2/ });
    expect(within(row).getByText("4")).toBeTruthy();
    expect(within(row).getByText("12")).toBeTruthy();
    expect(within(row).getByText("$400.00")).toBeTruthy();
    expect(within(row).getByText("$800.00")).toBeTruthy();
    expect(within(row).getByText("33.3 % del precio")).toBeTruthy();
    expect(screen.getByText("4 de 10 pedidos pagados (40 %) usaron una promoción.")).toBeTruthy();
    expect(mocks.calls).toEqual([{ p_store_id: "s1", p_from: null, p_to: null }]);
  });

  it("otro periodo: desde N días antes del «hoy» de la tienda", async () => {
    await show("7");
    expect(mocks.calls[1]).toEqual({ p_store_id: "s1", p_from: "2026-11-19", p_to: "2026-11-25" });
    expect(screen.getByRole("link", { name: "7 días" }).getAttribute("aria-current")).toBe("page");
  });

  it("sin la función del plan: invitación a Tienda Plus", async () => {
    mocks.error = new AppError("not_found");
    await show();
    expect(screen.getByRole("note").textContent).toContain("viene con el plan Tienda Plus");
    expect(screen.getByRole("link", { name: /Ver planes/ }).getAttribute("href")).toBe(
      "/admin/tienda/ajustes/plan",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("quien no ve el plan no recibe el enlace", async () => {
    mocks.error = new AppError("not_found");
    mocks.orgRole = null;
    await show();
    expect(screen.queryByRole("link", { name: /Ver planes/ })).toBeNull();
  });

  it("sin permiso de descuentos no existe", async () => {
    mocks.permissions = new Set();
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("otros errores no se esconden", async () => {
    mocks.error = new AppError("internal");
    await expect(show()).rejects.toThrow();
  });

  it("periodo sin pedidos con promoción", async () => {
    mocks.report = {
      ...report,
      rows: [],
      totals: { orders: 0, discount: 0, sales: 0, paid_orders: 0 },
    };
    await show();
    expect(
      screen.getByText("Ningún pedido pagado de este periodo usó una promoción."),
    ).toBeTruthy();
  });
});
