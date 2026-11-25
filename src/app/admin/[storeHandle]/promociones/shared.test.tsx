// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlanLimitNote, scopeText, windowText } from "./shared";

afterEach(cleanup);

describe("textos de la lista de promociones", () => {
  const tz = "America/Mexico_City";
  it("ventana de fechas en la zona de la tienda («hasta» es exclusivo)", () => {
    expect(windowText({ starts_at: null, ends_at: null }, tz)).toBe("sin fecha de fin");
    expect(
      windowText({ starts_at: "2026-12-01T06:00:00Z", ends_at: "2026-12-11T06:00:00Z" }, tz),
    ).toBe("del 1 dic 2026 al 10 dic 2026");
  });
  it("a qué aplica", () => {
    expect(scopeText({ scope: "store", promotion_targets: [] })).toBe("toda la tienda");
    expect(
      scopeText({ scope: "products", promotion_targets: [{ product_id: "a", category_id: null }] }),
    ).toBe("1 producto");
    expect(
      scopeText({
        scope: "categories",
        promotion_targets: [
          { product_id: null, category_id: "a" },
          { product_id: null, category_id: "b" },
        ],
      }),
    ).toBe("2 categorías");
  });
});

describe("límite del plan", () => {
  it("Tienda: 3 de 5", () => {
    render(<PlanLimitNote limit={{ limit: 5, used: 3, plan: "Tienda" }} activeHere={3} />);
    expect(screen.getByRole("note").textContent).toBe(
      "Promociones activas: 3 de 5 en tu plan Tienda (cuentan todas tus tiendas).",
    );
  });
  it("lleno: dice qué hacer", () => {
    render(<PlanLimitNote limit={{ limit: 5, used: 5, plan: "Tienda" }} activeHere={5} />);
    expect(screen.getByRole("note").textContent).toContain("Pausa una para activar otra");
  });
  it("Plus: sin tope práctico", () => {
    render(<PlanLimitNote limit={{ limit: 1000, used: 7, plan: "Tienda Plus" }} activeHere={7} />);
    expect(screen.getByRole("note").textContent).toContain("no tiene tope práctico");
  });
  it("plan sin el valor: se puede crear en borrador, no activar", () => {
    render(<PlanLimitNote limit={{ limit: 0, used: 0, plan: "Tienda" }} activeHere={0} />);
    expect(screen.getByRole("note").textContent).toContain("aún no incluye promociones activas");
  });
  it("quien no ve el plan solo ve las activas de la tienda", () => {
    render(<PlanLimitNote limit={null} activeHere={2} />);
    expect(screen.getByText(/Activas en esta tienda: 2/)).toBeTruthy();
  });
});
