// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelNotice } from "./notice-actions";

const panelNotices = vi.fn<(storeHandle: string) => Promise<PanelNotice[] | null>>();

vi.mock("./notice-actions", () => ({ panelNotices: (h: string) => panelNotices(h) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/mi-tienda" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { NoticesButton } = await import("./notices-button");

beforeEach(() => panelNotices.mockReset());
afterEach(cleanup);

function renderAndOpen() {
  render(<NoticesButton storeHandle="mi-tienda" />);
  fireEvent.click(screen.getByRole("button", { name: /Avisos/ }));
}

describe("NoticesButton", () => {
  it("sin avisos dice que todo está al día", async () => {
    panelNotices.mockResolvedValue([]);
    renderAndOpen();
    expect(await screen.findByText("No hay nada pendiente. Todo al día.")).toBeTruthy();
  });

  it("si no se pudieron revisar lo dice y no afirma «Todo al día»", async () => {
    // La acción devuelve null ante un fallo (también el .catch del cliente).
    // React 19 espera las promesas de act(): no se puede observar el estado
    // «Revisando…» ni un Promise.reject pendiente sin colgar el test.
    panelNotices.mockResolvedValue(null);
    renderAndOpen();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "No pudimos revisar tus avisos",
    );
    expect(screen.queryByText(/Todo al día/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("«Reintentar» vuelve a pedir los avisos", async () => {
    panelNotices.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    renderAndOpen();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("No hay nada pendiente. Todo al día.")).toBeTruthy();
    expect(panelNotices).toHaveBeenCalledTimes(2);
  });

  it("un aviso urgente aparece en la insignia", async () => {
    panelNotices.mockResolvedValue([
      { key: "attention", label: "1 pedido requiere atención", href: "/x", urgent: true },
    ]);
    renderAndOpen();
    expect(await screen.findByRole("link", { name: /1 pedido requiere atención/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Avisos/ }).textContent).toContain("1");
  });
});
