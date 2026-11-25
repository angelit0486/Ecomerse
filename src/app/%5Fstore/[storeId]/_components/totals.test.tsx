import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LinePromotions, orderItemPromotionNotes } from "./line-promotions";
import { Totals } from "./totals";

const store = { currency: "MXN", locale: "es-MX" };
const base = {
  subtotal: 32000,
  shipping_total: 9900,
  tax_total: 0,
  prices_include_tax: true,
  shippingKnown: true,
};

describe("totales con promociones (ADR-070, fase 3)", () => {
  it("separa promociones y cupón, con lo que calculó la base", () => {
    const html = renderToStaticMarkup(
      <Totals
        store={store}
        cart={{
          ...base,
          discount_total: 11000,
          promotion_total: 10000,
          promotions: [{ label: "3×2 en playeras", amount: 10000 }],
          total: 30900,
        }}
      />,
    );
    expect(html).toContain("<dt>Promoción: 3×2 en playeras</dt>");
    expect(html).toContain("−$100.00");
    expect(html).toContain("<dt>Descuento</dt><dd>−$10.00</dd>");
    expect(html).toContain("$309.00");
    expect(html).toContain("Ahorras $110.00");
  });

  it("sin detalle que cuadre, una sola fila «Promociones»", () => {
    const html = renderToStaticMarkup(
      <Totals
        store={store}
        cart={{
          ...base,
          discount_total: 10000,
          promotion_total: 10000,
          promotions: [],
          total: 31900,
        }}
      />,
    );
    expect(html).toContain("<dt>Promociones</dt>");
    expect(html).not.toContain("<dt>Descuento</dt>");
  });

  it("sin promociones se ve como antes", () => {
    const html = renderToStaticMarkup(
      <Totals store={store} cart={{ ...base, discount_total: 1000, total: 40900 }} />,
    );
    expect(html).toContain("<dt>Descuento</dt><dd>−$10.00</dd>");
    expect(html).not.toContain("Promoci");
    expect(html).not.toContain("Ahorras");
  });
});

describe("ahorro por línea", () => {
  it("la línea dice qué promoción y cuánto", () => {
    expect(
      renderToStaticMarkup(
        <LinePromotions notes={[{ label: "3×2 en playeras", amount: 10000 }]} store={store} />,
      ),
    ).toContain("3×2 en playeras: −$100.00");
    expect(renderToStaticMarkup(<LinePromotions notes={[]} store={store} />)).toBe("");
  });

  it("partida del pedido: leyendas de su copia y su ahorro", () => {
    expect(
      orderItemPromotionNotes({
        promotion_allocation: 10000,
        promotion_labels: ["3×2 en playeras"],
      }),
    ).toEqual([{ label: "3×2 en playeras", amount: 10000 }]);
    expect(orderItemPromotionNotes({ promotion_allocation: 0, promotion_labels: [] })).toEqual([]);
    expect(orderItemPromotionNotes({})).toEqual([]);
  });
});
