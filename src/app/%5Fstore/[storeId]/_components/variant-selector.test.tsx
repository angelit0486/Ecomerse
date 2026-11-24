import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../carrito/actions", () => ({ addItem: async () => ({}) }));

const { VariantSelector, initialVariant } = await import("./variant-selector");

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

describe("la ficha abre con el mismo precio que anunció la tarjeta", () => {
  const v = (id: string, priceCents: number, available = true) => ({ id, priceCents, available });

  it("abre con la variante disponible más barata, no con la primera", () => {
    const variants = [v("normal", 139900), v("oferta", 125900), v("otra", 139900)];
    expect(initialVariant(variants)?.id).toBe("oferta");
  });

  it("a igual precio, la primera; las agotadas no cuentan si hay disponibles", () => {
    expect(initialVariant([v("a", 100), v("b", 100)])?.id).toBe("a");
    expect(initialVariant([v("barata-agotada", 50, false), v("cara", 100)])?.id).toBe("cara");
  });

  it("todas agotadas: la más barata de todas; sin variantes, nada", () => {
    expect(initialVariant([v("a", 90, false), v("b", 70, false)])?.id).toBe("b");
    expect(initialVariant([])).toBeUndefined();
  });

  it("sin precio en centavos (llamadas antiguas), la primera disponible como antes", () => {
    const sin = [
      { id: "x", available: false },
      { id: "y", available: true },
      { id: "z", available: true },
    ];
    expect(initialVariant(sin)?.id).toBe("y");
  });
});
