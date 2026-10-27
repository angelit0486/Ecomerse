import { describe, expect, it } from "vitest";

import { productInputSchema } from "./product-input";

describe("productInputSchema", () => {
  it("guarda la descripción ya sanitizada (T-06)", () => {
    const parsed = productInputSchema.parse({
      title: "Gorra",
      description_html:
        '<p onclick="x()">Hola</p><script>alert(1)</script><img src=x onerror=alert(1)>',
      variants: [{ price: 9900 }],
    });
    expect(parsed.description_html).toBe("<p>Hola</p>");
    const onlyScript = productInputSchema.parse({
      title: "Gorra",
      description_html: "<script>alert(1)</script>",
      variants: [{ price: 9900 }],
    });
    expect(onlyScript.description_html).toBeNull();
  });

  it("acepta un producto simple con valores por defecto", () => {
    const parsed = productInputSchema.parse({ title: "Gorra", variants: [{ price: 9900 }] });
    expect(parsed.variants[0]).toMatchObject({
      status: "active",
      inventory_policy: "deny",
      options: {},
    });
  });

  it("rechaza compare_at_price ≤ precio, más de 3 opciones y dos categorías principales", () => {
    const base = { title: "X", variants: [{ price: 100 }] };
    const paths = (input: Record<string, unknown>) => {
      const result = productInputSchema.safeParse({ ...base, ...input });
      expect(result.success).toBe(false);
      return result.error!.issues.map((i) => i.path.join("."));
    };
    // Zod ≥ 4.6.6 deja de validar al pasarse del límite de una lista (protección de
    // memoria), así que cada regla se prueba por separado.
    expect(paths({ options: [1, 2, 3, 4].map((n) => ({ name: `O${n}`, values: ["a"] })) })).toEqual(
      ["options"],
    );
    expect(paths({ variants: [{ price: 100, compare_at_price: 100 }] })).toContain(
      "variants.0.compare_at_price",
    );
    expect(
      paths({
        categories: [
          { id: "0190a0d0-0000-7000-8000-000000000001", is_primary: true },
          { id: "0190a0d0-0000-7000-8000-000000000002", is_primary: true },
        ],
      }),
    ).toContain("categories");
  });

  it("rechaza precios negativos o fraccionarios (dinero en centavos)", () => {
    expect(productInputSchema.safeParse({ title: "X", variants: [{ price: -1 }] }).success).toBe(
      false,
    );
    expect(productInputSchema.safeParse({ title: "X", variants: [{ price: 10.5 }] }).success).toBe(
      false,
    );
  });

  it("rechaza separadores de firma en nombres de opción", () => {
    expect(
      productInputSchema.safeParse({
        title: "X",
        options: [{ name: "Color=Talla", values: ["a"] }],
        variants: [{ price: 1 }],
      }).success,
    ).toBe(false);
  });
});
