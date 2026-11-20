import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../carrito/actions", () => ({ addItem: async () => ({}) }));

const { VariantSelector } = await import("./variant-selector");

const variant = (sabor: string, imageUrl: string | null) => ({
  id: `00000000-0000-4000-8000-00000000000${sabor === "Menta" ? 1 : 2}`,
  options: { Sabor: sabor },
  price: "$749.00",
  compareAt: null,
  saving: null,
  availability: "Disponible",
  available: true,
  imageUrl,
});

const props = {
  storeId: "00000000-0000-4000-8000-0000000000aa",
  title: "Pluma",
  options: [{ name: "Sabor", values: ["Menta", "Mango"] }],
  variants: [variant("Menta", "https://m.test/menta.jpg"), variant("Mango", null)],
};

describe("sabores con su foto (plan de experiencia, fase 2)", () => {
  it("con el look, la opción con foto la muestra en su botón; la que no tiene, solo el texto", () => {
    const html = renderToStaticMarkup(<VariantSelector {...props} swatches />);
    expect(html.match(/class="sf-swatch/g)).toHaveLength(1);
    expect(html).toContain('src="https://m.test/menta.jpg"');
  });

  it("sin el look, los botones quedan como siempre", () => {
    const html = renderToStaticMarkup(<VariantSelector {...props} />);
    expect(html).not.toContain("sf-swatch");
  });
});
