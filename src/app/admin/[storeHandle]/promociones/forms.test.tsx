// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_PROMOTION } from "@/lib/promotions/form";

vi.mock("./actions", () => ({ savePromotion: vi.fn(), setPromotionStatus: vi.fn() }));

const { PromotionForm } = await import("./forms");

afterEach(cleanup);

const products = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Playera básica" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Gorra" },
];
const categories = [
  { id: "c1", name: "Ropa", depth: 0 },
  { id: "c2", name: "Playeras", depth: 1 },
];
const renderForm = () =>
  render(
    <PromotionForm
      storeHandle="mi-tienda"
      initial={EMPTY_PROMOTION}
      currency="MXN"
      products={products}
      categories={categories}
      productsTruncated={false}
    />,
  );

describe("formulario de promociones", () => {
  it("3×2 por omisión, con ejemplo en pesos", () => {
    renderForm();
    expect(screen.getByText("El cliente verá: Lleva 3, paga 2")).toBeTruthy();
    expect(screen.getByText(/si lleva 3, paga \$200\.00 en vez de \$300\.00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar como borrador" })).toBeTruthy();
  });

  it("la N-ésima: el ejemplo cambia al escribir", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Descuento en la N-ésima pieza/));
    fireEvent.change(screen.getByLabelText("Descuento (%)"), { target: { value: "100" } });
    expect(screen.getByText("El cliente verá: La segunda gratis")).toBeTruthy();
  });

  it("mayoreo: hasta 5 escalones y aviso si la regla no está completa", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Mayoreo \(precio por volumen\)/));
    expect(screen.getByText("Completa la regla para ver un ejemplo.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Escalón 1: desde (piezas)"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Escalón 1: precio por pieza (MXN)"), {
      target: { value: "85" },
    });
    expect(screen.getByText(/El cliente verá: Desde 6: \$85\.00 c\/u/)).toBeTruthy();
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Agregar escalón" }));
    }
    expect(screen.getAllByLabelText(/desde \(piezas\)/)).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Agregar escalón" })).toBeNull();
  });

  it("productos: buscar y agregar deja el id en el formulario", () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByLabelText(/^Productos/));
    fireEvent.change(screen.getByLabelText("Buscar un producto para agregar"), {
      target: { value: "play" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar Playera básica" }));
    expect(screen.getByText("Productos elegidos (1)")).toBeTruthy();
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[name="product_ids"]')].map(
        (i) => i.value,
      ),
    ).toEqual([products[0]!.id]);
  });

  it("categorías: casillas con sus subcategorías sangradas", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/^Categorías/));
    fireEvent.click(screen.getByLabelText("Playeras"));
    expect(screen.getByText("Categorías elegidas (1)")).toBeTruthy();
  });
});
