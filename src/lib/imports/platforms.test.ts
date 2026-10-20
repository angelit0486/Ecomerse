import { describe, expect, it } from "vitest";

import { planProductImport } from "@/server/imports/products";

import { detectPlatform, normalizeMoney, translatePlatformCsv } from "./platforms";

const SHOPIFY_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Barcode",
  "Image Src",
  "Image Position",
  "SEO Title",
  "Cost per item",
  "Status",
];

function row(values: Record<string, string>, headers = SHOPIFY_HEADERS) {
  return headers.map((h) => values[h] ?? "");
}

describe("detectPlatform", () => {
  it("reconoce Shopify, Tiendanube y el formato propio", () => {
    expect(detectPlatform(SHOPIFY_HEADERS)).toBe("shopify");
    expect(detectPlatform(["Identificador de URL", "Nombre", "Precio"])).toBe("tiendanube");
    expect(detectPlatform(["handle", "title", "price"])).toBe("pruva");
  });
});

describe("normalizeMoney", () => {
  it("acepta separadores de miles en español y en inglés", () => {
    expect(normalizeMoney("1.234,50")).toBe("1234.50");
    expect(normalizeMoney("1,234.50")).toBe("1234.50");
    expect(normalizeMoney("199,5")).toBe("199.5");
    expect(normalizeMoney("$ 349")).toBe("349");
    expect(normalizeMoney("29.99")).toBe("29.99");
    expect(normalizeMoney("gratis")).toBe("gratis");
  });
});

describe("translatePlatformCsv · Shopify", () => {
  const rows = [
    row({
      Handle: "whey-gold",
      Title: "Whey Gold",
      "Body (HTML)": "<p>Proteína</p>",
      Vendor: "Atlas",
      "Product Category": "Health",
      Tags: "proteina, whey",
      Published: "TRUE",
      "Option1 Name": "Sabor",
      "Option1 Value": "Vainilla",
      "Variant SKU": "WG-VAI",
      "Variant Grams": "907",
      "Variant Inventory Qty": "12",
      "Variant Inventory Policy": "deny",
      "Variant Price": "899.00",
      "Variant Compare At Price": "999.00",
      "Variant Requires Shipping": "TRUE",
      "Image Src": "https://cdn.shopify.com/a.jpg",
      "Cost per item": "450",
      Status: "active",
    }),
    row({
      Handle: "whey-gold",
      "Option1 Value": "Chocolate",
      "Variant SKU": "WG-CHO",
      "Variant Inventory Qty": "-2",
      "Variant Price": "899.00",
    }),
    // Foto extra: solo Handle e Image Src.
    row({
      Handle: "whey-gold",
      "Image Src": "https://cdn.shopify.com/b.jpg",
      "Image Position": "2",
    }),
    row({
      Handle: "creatina",
      Title: "Creatina",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Variant SKU": "CR-300",
      "Variant Price": "1,299.00",
      Published: "FALSE",
    }),
  ];
  const out = translatePlatformCsv(SHOPIFY_HEADERS, rows, [2, 3, 4, 5]);
  const col = (r: number, name: string) => out.rows[r]![out.headers.indexOf(name)];

  it("traduce cada presentación y descarta las filas de solo foto", () => {
    expect(out.platform).toBe("shopify");
    expect(out.rows).toHaveLength(3);
    expect(out.rowNumbers).toEqual([2, 3, 5]);
    expect(out.imageOnlyRows).toBe(1);
    expect(out.productsWithImageUrl).toBe(1);
    expect(col(0, "handle")).toBe("whey-gold");
    expect(col(0, "brand")).toBe("Atlas");
    expect(col(0, "tags")).toBe("proteina|whey");
    expect(col(0, "status")).toBe("active");
    expect(col(0, "compare_at_price")).toBe("999.00");
    expect(col(0, "cost")).toBe("450");
    expect(col(0, "weight_g")).toBe("907");
  });

  it("junta las fotos del producto (también las de filas de solo foto) en su primera fila", () => {
    expect(col(0, "image_urls")).toBe(
      "https://cdn.shopify.com/a.jpg|https://cdn.shopify.com/b.jpg",
    );
    expect(col(1, "image_urls")).toBe("");
    expect(col(2, "image_urls")).toBe("");
  });

  it("existencias negativas quedan en 0 y «Default Title» es un producto sin opciones", () => {
    expect(col(1, "inventory_quantity")).toBe("0");
    expect(col(2, "option1_name")).toBe("");
    expect(col(2, "option1_value")).toBe("");
    expect(col(2, "price")).toBe("1299.00");
  });

  it("sin «Status», «Published» decide: FALSE es borrador", () => {
    const headers = SHOPIFY_HEADERS.filter((h) => h !== "Status");
    const r = translatePlatformCsv(
      headers,
      [row({ Handle: "x", Title: "X", "Variant Price": "10", Published: "FALSE" }, headers)],
      [2],
    );
    expect(r.rows[0]![r.headers.indexOf("status")]).toBe("draft");
  });

  it("reporta lo que no se traduce (categoría, tipo, fotos se cuentan aparte)", () => {
    expect(out.ignored).toEqual(["Product Category", "Type", "Image Position"]);
    expect(out.ignored).not.toContain("Image Src");
  });

  it("el resultado pasa por el validador de PRUVA sin errores", () => {
    const plan = planProductImport(out.headers, out.rows, out.rowNumbers);
    expect(plan.flatMap((p) => p.errors)).toEqual([]);
    const whey = plan.find((p) => p.normalized?.handle === "whey-gold")!.normalized!;
    expect(whey.variants).toHaveLength(2);
    expect(whey.variants[0]!.price).toBe(89900);
    expect(whey.variants[0]!.compare_at_price).toBe(99900);
    expect(whey.variants[1]!.quantity).toBe(0);
    expect(whey.images).toEqual(["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"]);
    const creatina = plan.find((p) => p.normalized?.handle === "creatina")!.normalized!;
    expect(creatina.status).toBe("draft");
    expect(creatina.option_names).toEqual([]);
  });
});

describe("translatePlatformCsv · Tiendanube", () => {
  const headers = [
    "Identificador de URL",
    "Nombre",
    "Categorías",
    "Nombre de propiedad 1",
    "Valor de propiedad 1",
    "Precio",
    "Precio promocional",
    "Peso (kg)",
    "Alto (cm)",
    "Ancho (cm)",
    "Profundidad (cm)",
    "Stock",
    "SKU",
    "Código de barras",
    "Mostrar en tienda",
    "Envío sin cargo",
    "Descripción",
    "Tags",
    "Marca",
    "Producto Físico",
    "Costo",
  ];
  const rows = [
    row(
      {
        "Identificador de URL": "omega-3",
        Nombre: "Omega 3",
        Categorías: "Salud",
        "Nombre de propiedad 1": "Tamaño",
        "Valor de propiedad 1": "60 cápsulas",
        Precio: "1.250,00",
        "Precio promocional": "999,00",
        "Peso (kg)": "0,25",
        "Alto (cm)": "12",
        "Ancho (cm)": "6",
        "Profundidad (cm)": "6",
        Stock: "8",
        SKU: "OM-60",
        "Mostrar en tienda": "SI",
        Tags: "salud, corazón",
        Marca: "Nordic",
        "Producto Físico": "SI",
        Costo: "500",
      },
      headers,
    ),
    row(
      {
        "Identificador de URL": "omega-3",
        "Nombre de propiedad 1": "Tamaño",
        "Valor de propiedad 1": "120 cápsulas",
        Precio: "1.990,00",
        Stock: "",
        SKU: "OM-120",
      },
      headers,
    ),
  ];
  const out = translatePlatformCsv(headers, rows, [2, 3]);
  const col = (r: number, name: string) => out.rows[r]![out.headers.indexOf(name)];

  it("precio promocional menor: se cobra ese y el de lista queda tachado", () => {
    expect(out.platform).toBe("tiendanube");
    expect(col(0, "price")).toBe("999.00");
    expect(col(0, "compare_at_price")).toBe("1250.00");
    expect(col(1, "price")).toBe("1990.00");
    expect(col(1, "compare_at_price")).toBe("");
  });

  it("convierte kg a g y cm a mm; «Mostrar en tienda» decide el estado", () => {
    expect(col(0, "weight_g")).toBe("250");
    expect(col(0, "height_mm")).toBe("120");
    expect(col(0, "length_mm")).toBe("60");
    expect(col(0, "status")).toBe("active");
    expect(col(0, "requires_shipping")).toBe("true");
    expect(col(0, "tags")).toBe("salud|corazón");
  });

  it("Stock vacío no toca las existencias; categorías y envío sin cargo se ignoran", () => {
    expect(col(1, "inventory_quantity")).toBe("");
    expect(out.ignored).toEqual(["Categorías", "Envío sin cargo"]);
  });

  it("el resultado pasa por el validador de PRUVA sin errores", () => {
    const plan = planProductImport(out.headers, out.rows, out.rowNumbers);
    expect(plan.flatMap((p) => p.errors)).toEqual([]);
    const omega = plan[0]!.normalized!;
    expect(omega.brand).toBe("Nordic");
    expect(omega.variants.map((v) => v.price)).toEqual([99900, 199000]);
    expect(omega.variants[1]!.quantity).toBeUndefined();
  });
});

describe("translatePlatformCsv · formato propio", () => {
  it("lo deja igual", () => {
    const out = translatePlatformCsv(["handle", "title"], [["a", "A"]], [2]);
    expect(out).toMatchObject({ platform: "pruva", headers: ["handle", "title"], ignored: [] });
  });
});

describe("planProductImport · image_urls (ADR-033)", () => {
  const plan = (cell: string) =>
    planProductImport(
      ["handle", "title", "price", "image_urls"],
      [["cafe", "Café", "10", cell]],
      [2],
    );

  it("enlaces https separados por «|», sin repetidos", () => {
    const [row] = plan("https://a.example/1.jpg | https://a.example/2.png|https://a.example/1.jpg");
    expect(row!.errors).toEqual([]);
    expect(row!.normalized!.images).toEqual(["https://a.example/1.jpg", "https://a.example/2.png"]);
  });

  it("vacío: no agrega fotos (nunca se borran)", () => {
    expect(plan("")[0]!.normalized!.images).toBeUndefined();
  });

  it("http, con usuario o que no es enlace: error de la fila", () => {
    for (const bad of ["http://a.example/1.jpg", "https://u:p@a.example/1.jpg", "foto.jpg"]) {
      expect(plan(bad)[0]!.errors, bad).toEqual([
        "image_urls: el enlace 1 debe empezar con https:// y ser una dirección completa",
      ]);
    }
  });

  it("más de 10 fotos: error de la fila", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://a.example/${i}.jpg`).join("|");
    expect(plan(many)[0]!.errors).toEqual(["image_urls: máximo 10 fotos por producto"]);
  });
});
