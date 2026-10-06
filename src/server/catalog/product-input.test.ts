import { describe, expect, it } from "vitest";

import { productInputSchema } from "./product-input";

describe("productInputSchema", () => {
  it("acepta un producto simple con valores por defecto", () => {
    const parsed = productInputSchema.parse({ title: "Gorra", variants: [{ price: 9900 }] });
    expect(parsed.variants[0]).toMatchObject({
      status: "active",
      inventory_policy: "deny",
      options: {},
    });
  });

  it("rechaza compare_at_price ≤ precio, más de 3 opciones y dos categorías principales", () => {
    const bad = productInputSchema.safeParse({
      title: "X",
      options: [1, 2, 3, 4].map((n) => ({ name: `O${n}`, values: ["a"] })),
      variants: [{ price: 100, compare_at_price: 100 }],
      categories: [
        { id: "0190a0d0-0000-7000-8000-000000000001", is_primary: true },
        { id: "0190a0d0-0000-7000-8000-000000000002", is_primary: true },
      ],
    });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["options", "variants.0.compare_at_price", "categories"]),
    );
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
