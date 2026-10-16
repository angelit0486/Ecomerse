import { describe, expect, it } from "vitest";

import {
  ALL_IMPORT_HEADERS,
  checkHeaders,
  IMPORT_HEADERS,
  planProductImport,
  type ImportColumn,
} from "./products";

const H = [...IMPORT_HEADERS];
const row = (values: Partial<Record<ImportColumn, string>>, headers: readonly string[] = H) =>
  headers.map((h) => values[h as ImportColumn] ?? "");

describe("checkHeaders", () => {
  it("acepta la plantilla completa", () => {
    expect(checkHeaders(H)).toEqual({ ok: true, columns: H, ignored: [] });
  });
  it("ignora y avisa las columnas ajenas (la tienda nunca viene del archivo)", () => {
    expect(checkHeaders(["handle", "store_id", "price", "notas", ""])).toEqual({
      ok: true,
      columns: ["handle", "price"],
      ignored: ["store_id", "notas"],
    });
  });
  it("exige handle y rechaza columnas de la plantilla repetidas", () => {
    expect(checkHeaders(["title", "price", "price"])).toEqual({
      ok: false,
      missing: ["handle"],
      duplicated: ["price"],
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
        brand: "Marca",
      }),
      row({ handle: "playera", option1_name: "Talla", option1_value: "G", price: "199.50" }),
    ]);
    expect(plan.map((r) => r.errors)).toEqual([[], []]);
    const p = plan[0]!.normalized!;
    expect(p).toMatchObject({
      handle: "playera",
      status: "active",
      brand: "Marca",
      categories: ["Ropa > Camisas", "Ofertas"],
      option_names: ["Talla"],
      product: { title: "Playera", tags: ["algodón", "verano"], description_html: null },
    });
    expect(p.variants[0]).toMatchObject({
      row_number: 2,
      options: { Talla: "M" },
      sku: "PLA-M",
      price: 19950,
      quantity: 4,
    });
    expect(p.variants[1]).toMatchObject({
      row_number: 3,
      options: { Talla: "G" },
      sku: null,
      price: 19950,
    });
    expect(p.variants[1]).not.toHaveProperty("quantity");
    expect(plan[1]!.normalized).toBeNull();
  });

  it("una columna ausente no cambia nada; una celda vacía borra el dato opcional", () => {
    const minimal = ["handle", "price"];
    const [only] = planProductImport(minimal, [row({ handle: "taza", price: "10" }, minimal)]);
    expect(only!.errors).toEqual([]);
    expect(only!.normalized).toEqual({
      handle: "taza",
      product: {},
      option_names: null,
      variants: [{ row_number: 2, price: 1000 }],
    });

    const [blank] = planProductImport(H, [row({ handle: "taza" })]);
    const n = blank!.normalized!;
    // Título, precio, estado, política y envío vacíos = sin cambios.
    expect(n.product).not.toHaveProperty("title");
    expect(n).not.toHaveProperty("status");
    expect(n.variants[0]).not.toHaveProperty("price");
    expect(n.variants[0]).not.toHaveProperty("inventory_policy");
    expect(n.variants[0]).not.toHaveProperty("quantity");
    // Opcionales vacíos = borrar.
    expect(n).toMatchObject({ brand: null, categories: [] });
    expect(n.product).toMatchObject({ description_html: null, tags: [], seo_title: null });
    expect(n.variants[0]).toMatchObject({
      barcode: null,
      compare_at_price: null,
      weight_g: null,
      sku: null,
    });
  });

  it("asigna cada error a su fila (numerada como en la hoja: la 1 es el encabezado)", () => {
    const plan = planProductImport(H, [
      row({ handle: "taza", title: "Taza", price: "abc", sku: "T-1" }),
      row({ handle: "plato", title: "Plato", price: "10", sku: "t-1", inventory_policy: "quizá" }),
      row({ handle: "", price: "10" }),
      row({ handle: "vaso", title: "Vaso", price: "10", inventory_quantity: "2000000" }),
    ]);
    expect(plan[0]!.errors).toContain("price: escribe un importe como 199.50");
    expect(plan[1]!.errors).toEqual([
      "sku: repetido (también en la fila 2)",
      "inventory_policy: usa deny, continue",
    ]);
    expect(plan[2]!.errors).toEqual(["handle: es obligatorio"]);
    expect(plan[3]!.errors).toEqual([
      "inventory_quantity: escribe un número entero entre 0 y 1000000",
    ]);
  });

  it("opciones: valores por columna, combinaciones distintas y SKU sin columnas de opciones", () => {
    const plan = planProductImport(H, [
      // option2 sin option1: el valor sale de option2_value.
      row({
        handle: "gorra",
        title: "Gorra",
        option2_name: "Color",
        option2_value: "Rojo",
        price: "1",
      }),
      row({ handle: "gorra", option2_name: "Color", option2_value: "rojo", price: "1" }),
      row({ handle: "gorra", option2_name: "Color", price: "1" }),
    ]);
    expect(plan[0]!.normalized!.variants[0]!.options).toEqual({ Color: "Rojo" });
    expect(plan[1]!.errors).toContain("opciones: la misma combinación ya está en la fila 2");
    expect(plan[2]!.errors).toContain("option2_value: falta el valor de Color");

    const noOptions = ["handle", "sku", "price"];
    const bySku = planProductImport(noOptions, [
      row({ handle: "taza", sku: "A", price: "1" }, noOptions),
      row({ handle: "taza", sku: "B", price: "2" }, noOptions),
    ]);
    expect(bySku.flatMap((r) => r.errors)).toEqual([]);
    const ambiguous = planProductImport(noOptions, [
      row({ handle: "taza", sku: "A", price: "1" }, noOptions),
      row({ handle: "taza", price: "2" }, noOptions),
    ]);
    expect(ambiguous[0]!.errors[0]).toMatch(/cada fila del producto necesita su SKU/);
  });

  it("celdas de más, opciones repetidas y números de fila de la hoja", () => {
    const short = ["handle", "price", "seo_description"];
    const plan = planProductImport(
      short,
      [
        ["x", "1", "Camisa de algodón", " suave y fresca"],
        ["y", "1", "ok"],
      ],
      [2, 5],
    );
    expect(plan[0]!.errors).toEqual([
      "la fila tiene más celdas que el encabezado: revisa comas y comillas",
    ]);
    expect(plan.map((r) => r.row_number)).toEqual([2, 5]);

    const [dup] = planProductImport(H, [
      row({
        handle: "g",
        title: "G",
        option1_name: "Color",
        option1_value: "Rojo",
        option2_name: "color",
        option2_value: "Azul",
        price: "1",
      }),
    ]);
    expect(dup!.errors).toContain(
      "option*_name: cada opción del producto debe tener un nombre distinto",
    );
  });

  it("revierte la neutralización de fórmulas de la exportación y sanitiza la descripción", () => {
    const [plan] = planProductImport(H, [
      row({
        handle: "x",
        title: "'=Rebaja",
        price: "5",
        description: "<p>Hola</p><script>alert(1)</script>",
      }),
    ]);
    expect(plan!.normalized!.product.title).toBe("=Rebaja");
    expect(plan!.normalized!.product.description_html).toBe("<p>Hola</p>");
  });

  it("compare_at_price debe ser mayor que price (mismo esquema que el editor)", () => {
    const [plan] = planProductImport(H, [
      row({ handle: "x", title: "X", price: "10", compare_at_price: "9" }),
    ]);
    expect(plan!.errors).toEqual(["compare_at_price: debe ser mayor que price"]);
  });
});

describe("ficha sanitaria y atributos (R-T05)", () => {
  const RH = [
    "handle",
    "title",
    "price",
    "regulatory_category",
    "regulatory_ingredients",
    "regulatory_nutrition",
    "regulatory_servings_per_container",
    "regulatory_usage",
    "attributes",
  ];

  it("arma la ficha (vacío = se borra) y los atributos por clave", () => {
    const [first] = planProductImport(RH, [
      row(
        {
          handle: "omega-3",
          title: "Omega 3",
          price: "299",
          regulatory_category: "dietary_supplement",
          regulatory_ingredients: "Aceite de pescado",
          regulatory_nutrition: "Omega 3|1000|mg; EPA|180",
          regulatory_servings_per_container: "60",
          attributes: "objetivo:energia|corazon; sabor:limon",
        },
        RH,
      ),
    ]);
    expect(first!.errors).toEqual([]);
    expect(first!.normalized!.regulatory).toEqual({
      category: "dietary_supplement",
      data: {
        ingredients: "Aceite de pescado",
        nutrition: [
          { name: "Omega 3", amount: "1000", unit: "mg" },
          { name: "EPA", amount: "180" },
        ],
        servings_per_container: 60,
        usage: null,
      },
    });
    expect(first!.normalized!.attributes).toEqual({
      objetivo: ["energia", "corazon"],
      sabor: ["limon"],
    });
  });

  it("explica los errores de la ficha y de los atributos", () => {
    const [a] = planProductImport(RH, [
      row({ handle: "a", regulatory_ingredients: "Algo", attributes: "Objetivo:Energía" }, RH),
    ]);
    expect(a!.errors).toEqual([
      "regulatory_category: indica dietary_supplement o none para guardar la ficha",
      "attributes: «Objetivo:Energía»: usa clave:valor|valor con las claves del atributo.",
    ]);
    const [b] = planProductImport(RH, [
      row({ handle: "b", regulatory_category: "none", regulatory_usage: "x" }, RH),
    ]);
    expect(b!.errors).toEqual([
      "regulatory_category: un producto no regulado no lleva ficha sanitaria",
    ]);
    const [c] = planProductImport(RH, [
      row(
        { handle: "c", regulatory_category: "dietary_supplement", regulatory_nutrition: "EPA" },
        RH,
      ),
    ]);
    expect(c!.errors).toEqual(["regulatory_nutrition: Renglón 1: falta el nombre o la cantidad."]);
  });

  it("las columnas de la ficha piden regulatory_category; vacío = sin cambios", () => {
    expect(checkHeaders(["handle", "regulatory_usage"])).toEqual({
      ok: false,
      missing: ["regulatory_category"],
      duplicated: [],
    });
    const [first] = planProductImport(["handle", "regulatory_category"], [["x", ""]]);
    expect(first!.normalized!.regulatory).toBeUndefined();
  });
});

describe("costo unitario (Fase B)", () => {
  const C = ["handle", "title", "sku", "price", "cost"];
  it("lee el costo como el precio; vacío = se borra", () => {
    const plan = planProductImport(C, [
      row({ handle: "a", title: "A", sku: "a-1", price: "100", cost: "45,50" }, C),
      row({ handle: "b", title: "B", sku: "b-1", price: "100", cost: "" }, C),
    ]);
    expect(plan[0]!.normalized!.variants[0]!.cost).toBe(4550);
    expect(plan[1]!.normalized!.variants[0]!.cost).toBeNull();
  });
  it("sin la columna, no toca el costo", () => {
    const plan = planProductImport(H, [row({ handle: "a", title: "A", price: "100" })]);
    expect(plan[0]!.normalized!.variants[0]).not.toHaveProperty("cost");
  });
  it("un costo inválido es un error de la fila", () => {
    const plan = planProductImport(C, [
      row({ handle: "a", title: "A", sku: "a-1", price: "100", cost: "-3" }, C),
    ]);
    expect(plan[0]!.errors).toContain("cost: escribe un importe como 199.50");
  });
  it("la plantilla completa acepta la columna", () => {
    expect(checkHeaders(["handle", "cost"])).toEqual({
      ok: true,
      columns: ["handle", "cost"],
      ignored: [],
    });
  });
});

describe("plantilla del catálogo de suplementos (docs/catalogo)", () => {
  it("trae exactamente las columnas que acepta la importación, en el mismo orden", async () => {
    const { readFileSync } = await import("node:fs");
    const header = readFileSync("docs/catalogo/plantilla-catalogo-suplementos.csv", "utf8").trim();
    expect(header.split(",")).toEqual([...ALL_IMPORT_HEADERS]);
  });
});

describe("borrador del catálogo desde la investigación (docs/catalogo)", () => {
  it("se importa sin errores: borrador, variantes inactivas y columnas de referencia ignoradas", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseCsv } = await import("@/lib/csv-parse");
    const parsed = parseCsv(
      readFileSync("docs/catalogo/borrador-catalogo-investigacion.csv", "utf8"),
    );
    const check = checkHeaders(parsed.headers);
    expect(check.ok && check.ignored.every((c) => c.startsWith("ref_"))).toBe(true);
    const plan = planProductImport(parsed.headers, parsed.rows);
    expect(plan.flatMap((r) => r.errors.map((e) => `${r.row_number}: ${e}`))).toEqual([]);
    const products = plan.filter((r) => r.normalized).map((r) => r.normalized!);
    expect(products.length).toBe(19);
    expect(products.every((p) => p.status === "draft")).toBe(true);
    expect(products.flatMap((p) => p.variants).every((v) => v.status === "inactive")).toBe(true);
  });
});
