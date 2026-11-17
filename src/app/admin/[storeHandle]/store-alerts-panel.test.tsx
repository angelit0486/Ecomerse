// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoreAlert } from "@/lib/store-alerts/alerts";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StoreAlertsPanel } = await import("./store-alerts-panel");

afterEach(cleanup);

describe("StoreAlertsPanel", () => {
  it("si las alertas fallaron lo dice y enlaza a la salud de la tienda", () => {
    render(<StoreAlertsPanel alerts="error" healthHref="/admin/mi-tienda/salud" />);
    expect(screen.getByRole("heading", { name: "Qué atender hoy" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "No pudimos calcular las alertas ahora.",
    );
    const health = screen.getByRole("link", { name: "Ver la salud de la tienda" });
    expect(health.getAttribute("href")).toBe("/admin/mi-tienda/salud");
    expect(screen.queryByText(/Todo en orden/)).toBeNull();
  });

  it("sin permiso para abrir Salud, avisa del fallo sin enlace", () => {
    render(<StoreAlertsPanel alerts="error" healthHref={null} />);
    expect(screen.getByRole("status").textContent).toBe("No pudimos calcular las alertas ahora.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sin alertas reales dice que todo está en orden", () => {
    render(<StoreAlertsPanel alerts={[]} healthHref="/x" />);
    expect(screen.getByText(/Todo en orden/)).toBeTruthy();
  });

  it("muestra cada alerta con su conteo", () => {
    const alert: StoreAlert = {
      key: "sin_foto",
      level: "media",
      title: "Sin foto",
      count: 2,
      description: "d",
      action: "a",
      href: "/admin/mi-tienda/productos?x=1",
    };
    render(<StoreAlertsPanel alerts={[alert]} healthHref="/x" />);
    expect(screen.getByText("Sin foto:", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver los productos" })).toBeTruthy();
  });
});
