import { describe, expect, it } from "vitest";

import { matchFiles, stem, uploadOrder, type MatchTarget } from "./bulk-match";

const targets: MatchTarget[] = [
  {
    id: "p1",
    title: "Proteína aislada",
    slug: "proteina-aislada",
    skus: ["PRV-001", "PRV-002"],
    variants: [
      { id: "v1", sku: "PRV-001" },
      { id: "v2", sku: "PRV-002" },
    ],
  },
  {
    id: "p2",
    title: "Creatina",
    slug: "creatina",
    skus: ["CRE-300"],
    variants: [{ id: "v3", sku: "CRE-300" }],
  },
  { id: "p3", title: "Omega 3", slug: "omega-3", skus: [] },
  // El mismo SKU en dos productos: nunca se adivina.
  { id: "p4", title: "Duplicado A", slug: "dup-a", skus: ["DUP-1"] },
  { id: "p5", title: "Duplicado B", slug: "dup-b", skus: ["dup-1"] },
];

describe("stem", () => {
  it("quita la extensión y la carpeta", () => {
    expect(stem("fotos/PRV-001.JPG")).toBe("PRV-001");
    expect(stem("C:\\fotos\\creatina.webp")).toBe("creatina");
  });
});

describe("matchFiles", () => {
  it("empareja por SKU sin distinguir mayúsculas", () => {
    const [m] = matchFiles(["prv-001.jpg"], targets);
    expect(m).toMatchObject({ productId: "p1", matchedBy: "sku", order: 1, ambiguous: false });
  });

  it("cualquier SKU de las presentaciones lleva al producto", () => {
    expect(matchFiles(["PRV-002.png"], targets)[0]!.productId).toBe("p1");
  });

  it("número final = orden de la foto (guion, guion bajo o espacio)", () => {
    const m = matchFiles(["PRV-001-2.jpg", "PRV-001_3.jpg", "creatina 4.jpg"], targets);
    expect(m.map((x) => [x.productId, x.order])).toEqual([
      ["p1", 2],
      ["p1", 3],
      ["p2", 4],
    ]);
  });

  it("un SKU que termina en número se reconoce completo antes de cortar", () => {
    expect(matchFiles(["CRE-300.jpg"], targets)[0]).toMatchObject({ productId: "p2", order: 1 });
  });

  it("empareja por nombre corto del producto", () => {
    expect(matchFiles(["Omega-3.webp"], targets)[0]).toMatchObject({
      productId: "p3",
      matchedBy: "nombre",
    });
    expect(matchFiles(["omega-3-2.webp"], targets)[0]).toMatchObject({ productId: "p3", order: 2 });
  });

  it("sin coincidencia o con SKU repetido no asigna", () => {
    const [none, dup] = matchFiles(["foto-random.jpg", "DUP-1.jpg"], targets);
    expect(none).toMatchObject({ productId: null, matchedBy: null, ambiguous: false });
    expect(dup).toMatchObject({ productId: null, ambiguous: true });
  });
});

describe("foto de cada presentación", () => {
  it("el SKU exacto de un sabor de un producto con varios es la foto de ese sabor", () => {
    expect(matchFiles(["prv-002.jpg"], targets)[0]).toMatchObject({
      productId: "p1",
      variantId: "v2",
      variantSku: "PRV-002",
    });
  });

  it("con número de foto, por nombre o con una sola presentación, solo va al producto", () => {
    const [second, byName, single] = matchFiles(
      ["PRV-002-2.jpg", "proteina-aislada.jpg", "CRE-300.jpg"],
      targets,
    );
    expect(second).toMatchObject({ productId: "p1", order: 2, variantId: null });
    expect(byName).toMatchObject({ productId: "p1", variantId: null });
    expect(single).toMatchObject({ productId: "p2", variantId: null });
  });
});

describe("uploadOrder", () => {
  it("agrupa por producto, ordena por número y deja fuera lo no emparejado", () => {
    const order = uploadOrder(
      matchFiles(
        ["PRV-001-3.jpg", "nada.jpg", "PRV-001.jpg", "creatina.jpg", "PRV-001-2.jpg"],
        targets,
      ),
    ).map((m) => m.name);
    expect(order).toEqual(["PRV-001.jpg", "PRV-001-2.jpg", "PRV-001-3.jpg", "creatina.jpg"]);
  });
});
