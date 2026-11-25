import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductPromotions } from "./product-promotions";

describe("promociones en la ficha (ADR-070, fase 3)", () => {
  it("leyenda, regla y escalones de mayoreo", () => {
    const html = renderToStaticMarkup(
      <ProductPromotions
        currency="MXN"
        promotions={[
          { id: "a", label: "3×2 en playeras", type: "buy_n_pay_m", rules: { buy: 3, pay: 2 } },
          {
            id: "b",
            label: "Mayoreo",
            type: "volume",
            rules: {
              mode: "unit_price",
              tiers: [
                { min_qty: 6, value: 15000 },
                { min_qty: 12, value: 13000 },
              ],
            },
          },
        ]}
      />,
    );
    expect(html).toContain("Promociones</h2>");
    expect(html).toContain("3×2 en playeras");
    expect(html).toContain("Lleva 3, paga 2");
    expect(html).toContain("6 piezas o más: $150.00 c/u");
    expect(html).toContain("12 piezas o más: $130.00 c/u");
    expect(html).toContain("te damos la que más te ahorra");
  });

  it("sin promociones válidas no ocupa lugar", () => {
    expect(renderToStaticMarkup(<ProductPromotions currency="MXN" promotions={undefined} />)).toBe(
      "",
    );
    expect(
      renderToStaticMarkup(
        <ProductPromotions
          currency="MXN"
          promotions={[{ id: "x", label: "x", type: "buy_n_pay_m", rules: { buy: 1, pay: 1 } }]}
        />,
      ),
    ).toBe("");
  });
});
