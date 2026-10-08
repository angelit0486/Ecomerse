import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PurchaseLegends, SupplementInfo } from "./supplement-info";

const base = {
  category: "dietary_supplement",
  category_name: "Suplemento alimenticio",
  legends: [{ key: "l1", text: "LEYENDA <b>uno</b>" }],
};

describe("SupplementInfo", () => {
  it("muestra la ficha y las leyendas como texto, nunca como HTML", () => {
    const markup = renderToStaticMarkup(
      <SupplementInfo
        info={{
          ...base,
          data: {
            form: "Cápsulas",
            servings_per_container: 60,
            usage: "Tomar <script>alert(1)</script>",
            nutrition: [{ name: "Omega 3", amount: "1000", unit: "mg" }],
          },
        }}
      />,
    );
    expect(markup).toContain("Información del suplemento alimenticio");
    expect(markup).toContain("LEYENDA &lt;b&gt;uno&lt;/b&gt;");
    expect(markup).toContain("Tomar &lt;script&gt;");
    expect(markup).not.toContain("<script");
    expect(markup).toContain("<dd>Cápsulas</dd>");
    expect(markup).toContain("<dd>60</dd>");
    expect(markup).toContain(">Omega 3</th>");
    expect(markup).toContain(">1000 mg</td>");
    // Sin %VNR en ningún renglón no hay columna vacía.
    expect(markup).not.toContain("%VNR");
  });

  it("agrega la columna %VNR si algún renglón la trae", () => {
    const markup = renderToStaticMarkup(
      <SupplementInfo
        info={{
          ...base,
          legends: [],
          data: {
            nutrition: [
              { name: "Vitamina C", amount: "90", unit: "mg", dv: "100%" },
              { name: "Zinc", amount: "11" },
            ],
          },
        }}
      />,
    );
    expect(markup).toContain("%VNR");
    expect(markup).toContain(">100%</td>");
    expect(markup).toContain(">11</td><td");
    expect(markup).not.toContain('role="note"');
  });
});

describe("PurchaseLegends", () => {
  it("no muestra nada sin leyendas y las muestra como texto", () => {
    expect(renderToStaticMarkup(<PurchaseLegends legends={[]} />)).toBe("");
    const markup = renderToStaticMarkup(
      <PurchaseLegends legends={[{ key: "c", text: "COMPRA <i>x</i>" }]} />,
    );
    expect(markup).toContain('aria-label="Leyendas sanitarias"');
    expect(markup).toContain("COMPRA &lt;i&gt;x&lt;/i&gt;");
  });
});
