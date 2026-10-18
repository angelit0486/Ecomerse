import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/storefront/catalog", () => ({ mediaUrl: (p: string) => `https://m.test/${p}` }));
vi.mock("../carrito/actions", () => ({ addItem: async () => ({}) }));

const { ProductGrid } = await import("./product-card");

const store = { id: "s1", currency: "MXN", locale: "es-MX" };
const base = {
  id: "p1",
  slug: "proteina",
  title: "Proteína",
  brand: "Marca",
  availability: "in_stock" as const,
  image: null,
  published_at: null,
};

function card(
  overrides: Record<string, unknown>,
  quickAdd: Record<string, string | null> = {},
): string {
  return renderToStaticMarkup(
    <ProductGrid
      products={[
        { ...base, min_price: 89900, max_price: 89900, compare_at_price: null, ...overrides },
      ]}
      store={store}
      quickAdd={quickAdd}
    />,
  );
}

describe("tarjeta de producto (revisión de conversión, A6)", () => {
  it("descuento redondeado hacia abajo y precio por porción", () => {
    const markup = card({ compare_at_price: 104900, servings: 30 });
    expect(markup).toContain("−14 %");
    expect(markup).toContain("$29.97 por porción");
    expect(markup).toContain("30 porciones");
  });

  it("con una sola porción no muestra precio por porción", () => {
    expect(card({ servings: 1 })).not.toContain("por porción");
  });

  it("sin porciones declaradas ni descuento, solo el precio", () => {
    const markup = card({});
    expect(markup).not.toContain("por porción");
    expect(markup).not.toContain("%");
  });

  it("con precios distintos por variante no inventa un descuento ni un precio por porción", () => {
    const markup = card({ max_price: 99900, compare_at_price: 104900, servings: 30 });
    expect(markup).toContain("Desde");
    expect(markup).not.toContain("por porción");
    expect(markup).not.toContain("−");
  });
});

describe("«Agregar» desde la tarjeta (rediseño A+B)", () => {
  it("producto simple: formulario con solo la variante y una pieza", () => {
    const markup = card({}, { p1: "v1" });
    expect(markup).toContain('name="variant_id" value="v1"');
    expect(markup).toContain('name="quantity" value="1"');
    expect(markup).toContain("Agregar<span");
    expect(markup).not.toMatch(/name="(price|total|unit_price)"/);
  });

  it("con opciones: «Elegir opción» lleva a la ficha", () => {
    const markup = card({}, { p1: null });
    expect(markup).toContain('href="/productos/proteina"');
    expect(markup).toContain("Elegir opción");
    expect(markup).not.toContain("variant_id");
  });

  it("agotado o sin dato de variante: sin botón", () => {
    expect(card({ availability: "out_of_stock" }, { p1: "v1" })).not.toContain("variant_id");
    const unknown = card({});
    expect(unknown).not.toContain("variant_id");
    expect(unknown).not.toContain("Elegir opción");
  });
});

describe("borrador en la vista previa (ADR-032)", () => {
  it("lleva «Sin publicar» y ningún botón de compra, aunque llegue una variante", () => {
    const simple = card({ unpublished: true }, { p1: "v1" });
    expect(simple).toContain("Sin publicar");
    expect(simple).not.toContain("variant_id");
    const options = card({ unpublished: true }, { p1: null });
    expect(options).not.toContain("Elegir opción");
  });

  it("un producto publicado no lleva la marca", () => {
    expect(card({ unpublished: false }, { p1: "v1" })).not.toContain("Sin publicar");
  });
});
