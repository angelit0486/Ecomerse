import { describe, expect, it } from "vitest";

import { servingsByContent, suggestBrand, suggestCategory, words } from "./suggest";

const brands = [
  { id: "b1", name: "Optimum Nutrition" },
  { id: "b2", name: "Dymatize" },
  { id: "b3", name: "Nutrition" },
];
const categories = [
  { id: "c1", name: "Proteínas", depth: 0 },
  { id: "c2", name: "Proteína whey", depth: 1 },
  { id: "c3", name: "Creatinas", depth: 0 },
  { id: "c4", name: "Ropa deportiva", depth: 0 },
];

describe("words", () => {
  it("quita acentos, signos y palabras de una letra", () => {
    expect(words("Proteína Whey (2 lb) – Sabor Chocolate")).toEqual([
      "proteina",
      "whey",
      "lb",
      "sabor",
      "chocolate",
    ]);
  });
});

describe("suggestBrand", () => {
  it("encuentra la marca dentro del nombre; gana el nombre más largo", () => {
    expect(suggestBrand("Gold Standard Whey Optimum Nutrition 5 lb", brands)?.id).toBe("b1");
    expect(suggestBrand("ISO 100 dymatize chocolate", brands)?.id).toBe("b2");
  });

  it("no inventa: sin coincidencia de palabra completa no sugiere", () => {
    expect(suggestBrand("Creatina monohidratada", brands)).toBeNull();
    expect(suggestBrand("Dymatized", brands)).toBeNull();
  });
});

describe("suggestCategory", () => {
  it("elige la de más palabras en común, y la más específica si empatan", () => {
    expect(suggestCategory("Proteína whey vainilla 2 lb", categories)?.id).toBe("c2");
    expect(suggestCategory("Creatina monohidratada 300 g", categories)?.id).toBe("c3");
  });

  it("singular y plural cuentan igual; sin coincidencias no sugiere", () => {
    expect(suggestCategory("Proteínas veganas", categories)?.id).toBe("c1");
    expect(suggestCategory("Shaker 600 ml", categories)).toBeNull();
  });
});

describe("servingsByContent", () => {
  it("toma las porciones más comunes por contenido, sin distinguir mayúsculas", () => {
    expect(
      servingsByContent([
        { net_content: "907 g", servings_per_container: 30 },
        { net_content: "907 G", servings_per_container: 30 },
        { net_content: "907 g", servings_per_container: 28 },
        { net_content: "60 cápsulas", servings_per_container: 60 },
        { net_content: "2 kg", servings_per_container: null },
        { net_content: null, servings_per_container: 10 },
      ]),
    ).toEqual({ "907 g": 30, "60 cápsulas": 60 });
  });
});
