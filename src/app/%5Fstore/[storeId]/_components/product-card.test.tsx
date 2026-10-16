import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/storefront/catalog", () => ({ mediaUrl: (p: string) => `https://m.test/${p}` }));

const { ProductGrid } = await import("./product-card");

const store = { currency: "MXN", locale: "es-MX" };
const base = {
  id: "p1",
  slug: "proteina",
  title: "Proteína",
  brand: "Marca",
  availability: "in_stock" as const,
  image: null,
  published_at: null,
};

function card(overrides: Record<string, unknown>): string {
  return renderToStaticMarkup(
    <ProductGrid
      products={[
        { ...base, min_price: 89900, max_price: 89900, compare_at_price: null, ...overrides },
      ]}
      store={store}
    />,
  );
}

describe("tarjeta de producto (revisión de conversión, A6)", () => {
  it("descuento redondeado hacia abajo y precio por porción", () => {
    const markup = card({ compare_at_price: 104900, servings: 30 });
    expect(markup).toContain("−14 %");
    expect(markup).toContain("30 porciones · $29.97 por porción");
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
