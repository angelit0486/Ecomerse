import { describe, expect, it } from "vitest";

import { checkHeaders, IMPORT_HEADERS, planProductImport } from "./products";

const H = [...IMPORT_HEADERS];
const row = (values: Partial<Record<(typeof IMPORT_HEADERS)[number], string>>) =>
  H.map((h) => values[h] ?? "");

describe("checkHeaders", () => {
  it("acepta la plantilla completa", () => {
    expect(checkHeaders(H)).toEqual({ ok: true });
  });
  it("rechaza columnas ajenas (la tienda nunca viene del archivo) y exige las obligatorias", () => {
    expect(checkHeaders(["handle", "store_id"])).toEqual({
      ok: false,
      missing: ["price"],
      unknown: ["store_id"],
    });
  });
});

describe("planProductImport", () => {
  it("agrupa variantes por handle y toma el producto de la primera fila", () => {
    const plan = planProductImport(H, [
      row({
        handle: "Playera",
        title: "Playera",
        status: "active",
        option1_name: "Talla",
        option1_value: "M",
        sku: "pla-m",
        price: "199,50",
        inventory_quantity: "4",
        categories: "Ropa > Camisas|Ofertas",
        tags: "algodón| verano",
      }),
      row({ handle: "playera", option1_name: "Talla", option1_value: "G", price: "199.50" }),
    ]);
    expect(plan.map((r) => r.errors)).toEqual([[], []]);
    const p = plan[0]!.normalized!;
    expect(p.handle).toBe("playera");
    expect(p.publish).toBe(true);
    expect(p.categories).toEqual(["Ropa > Camisas", "Ofertas"]);
    expect(p.inventory).toEqual([{ variant_index: 0, quantity: 4, row_number: 2 }]);
    expect(p.payload).toMatchObject({
      slug: "playera",
      tags: ["algodón", "verano"],
      options: [{ name: "Talla", values: ["M", "G"] }],
      variants: [
        { options: { Talla: "M" }, sku: "PLA-M", price: 19950, position: 0 },
        { options: { Talla: "G" }, sku: null, price: 19950, position: 1 },
      ],
    });
    expect(plan[1]!.normalized).toBeNull();
  });

  it("asigna cada error a su fila (numerada como en la hoja: la 1 es el encabezado)", () => {
    const plan = planProductImport(H, [
      row({ handle: "taza", title: "Taza", price: "abc", sku: "T-1" }),
      row({ handle: "plato", title: "Plato", price: "10", sku: "t-1", inventory_policy: "quizá" }),
      row({ handle: "", price: "10" }),
    ]);
    expect(plan[0]!.row_number).toBe(2);
    expect(plan[0]!.errors).toContain("price: escribe un importe como 199.50");
    expect(plan[1]!.errors).toEqual([
      "sku: repetido (también en la fila 2)",
      "inventory_policy: usa deny o continue",
    ]);
    expect(plan[2]!.errors).toEqual(["handle: es obligatorio"]);
  });

  it("exige título, valores de opción y combinaciones distintas", () => {
    const plan = planProductImport(H, [
      row({ handle: "gorra", option1_name: "Color", option1_value: "Rojo", price: "1" }),
      row({ handle: "gorra", option1_name: "Color", option1_value: "Rojo", price: "1" }),
      row({ handle: "gorra", option1_name: "Color", price: "1" }),
    ]);
    expect(plan[0]!.errors).toContain("title: es obligatorio en la primera fila del producto");
    expect(plan[0]!.errors).toContain(
      "opciones: dos filas del producto tienen la misma combinación",
    );
    expect(plan[2]!.errors).toContain("option1_value: falta el valor de Color");
  });

  it("revierte la neutralización de fórmulas de la exportación y nunca inventa datos", () => {
    const plan = planProductImport(H, [
      row({ handle: "x", title: "'=Rebaja", price: "5", description: "" }),
    ]);
    const payload = plan[0]!.normalized!.payload;
    expect(payload.title).toBe("=Rebaja");
    expect(payload.description_html).toBeNull();
    expect(payload.seo_title).toBeNull();
    expect(plan[0]!.normalized!.brand).toBeNull();
    expect(plan[0]!.normalized!.publish).toBe(false);
  });

  it("sanitiza la descripción con el mismo esquema que el editor", () => {
    const plan = planProductImport(H, [
      row({
        handle: "x",
        title: "X",
        price: "5",
        description: "<p>Hola</p><script>alert(1)</script>",
      }),
    ]);
    expect(plan[0]!.normalized!.payload.description_html).toBe("<p>Hola</p>");
  });
});
