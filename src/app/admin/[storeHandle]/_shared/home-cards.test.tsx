// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { metricComparison } from "@/lib/dashboard/home-insights";

import { CardError, ComparisonLine } from "./home-cards";

afterEach(cleanup);

const count = (n: number) => n.toLocaleString("es-MX");

describe("CardError", () => {
  it("dice qué no se pudo cargar, sin cifras, y enlaza a reintentar", () => {
    render(<CardError what="tus ventas" retryHref="/admin/mi-tienda?rango=7" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("No pudimos cargar tus ventas.");
    expect(status.textContent).not.toMatch(/\d/);
    const retry = screen.getByRole("link", { name: "Reintenta" });
    expect(retry.getAttribute("href")).toBe("/admin/mi-tienda?rango=7");
  });
});

describe("ComparisonLine", () => {
  it("sube: texto, marca ▲ oculta al lector de pantalla y color de éxito", () => {
    const { container } = render(
      <ComparisonLine comparison={metricComparison(15, 10, count, "x")} />,
    );
    const line = container.querySelector("p")!;
    expect(line.textContent).toBe("▲ +5 (+50 %) vs. periodo anterior");
    expect(line.className).toContain("text-success");
    expect(line.querySelector("[aria-hidden='true']")?.textContent).toBe("▲ ");
  });

  it("baja: ▼ y color de peligro", () => {
    const { container } = render(
      <ComparisonLine comparison={metricComparison(2, 3, count, "x")} />,
    );
    const line = container.querySelector("p")!;
    expect(line.textContent).toBe("▼ −1 (−33.3 %) vs. periodo anterior");
    expect(line.className).toContain("text-danger");
  });

  it("igual: sin marca y en gris", () => {
    const { container } = render(
      <ComparisonLine comparison={metricComparison(4, 4, count, "x")} />,
    );
    const line = container.querySelector("p")!;
    expect(line.textContent).toBe("Igual que el periodo anterior");
    expect(line.className).toContain("text-fg-muted");
  });

  it("anterior en cero: el texto explicativo, sin ∞ ni marca", () => {
    const { container } = render(
      <ComparisonLine
        comparison={metricComparison(500, 0, count, "Sin ventas en el periodo anterior")}
      />,
    );
    const line = container.querySelector("p")!;
    expect(line.textContent).toBe("Sin ventas en el periodo anterior");
    expect(line.textContent).not.toMatch(/∞|Infinity|NaN/);
    expect(line.className).toContain("text-fg-muted");
  });
});
