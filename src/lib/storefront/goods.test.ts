import { describe, expect, it } from "vitest";

import { goodFor, shelfFor } from "./goods";

describe("goodFor", () => {
  it.each([
    ["Playeras", "shirt"],
    ["Ejemplo · Sudadera con capucha", "hoodie"],
    ["Pantalón de mezclilla", "pants"],
    ["Gorra de gabardina", "cap"],
    ["Proteína de suero", "tub"],
    ["Creatinas", "jar"],
    ["Vitaminas", "capsule"],
    ["Preentrenos", "shaker"],
    ["Cuidado de la piel", "dropper"],
    ["Labial mate", "lipstick"],
    ["Shampoo sin sulfatos", "comb"],
    ["Bebidas", "bottle"],
    ["Detergente líquido", "spray"],
    ["Papas fritas 170 g", "snack"],
    ["Arroz 1 kg", "jar"],
    ["Velas y aromas", "candle"],
    ["Collar ajustable para perro", "collar"],
    ["Accesorios", "bag"],
    ["Botanas", "snack"],
    ["Maceta de barro con plato", "plant"],
    ["Cama acolchada lavable", "petbed"],
    ["Botas de piel", "shoe"],
    ["Funda para laptop", "tag"],
  ] as const)("%s → %s", (name, good) => {
    expect(goodFor(name)).toBe(good);
  });

  it("sin coincidencia usa el respaldo", () => {
    expect(goodFor("Destacados")).toBe("tag");
    expect(goodFor("Novedades", "box")).toBe("box");
  });

  it("lo específico gana: un collar no es un accesorio cualquiera", () => {
    expect(goodFor("Accesorios: collar y correa")).toBe("collar");
  });
});

describe("shelfFor", () => {
  it("un objeto por categoría, sin repetir, hasta el máximo", () => {
    expect(shelfFor(["Playeras", "Pantalones", "Sudaderas", "Accesorios"])).toEqual([
      "shirt",
      "pants",
      "hoodie",
      "bag",
    ]);
    expect(shelfFor(["Playeras", "Camisas", "Blusas"])).toEqual(["shirt", "bag", "tag"]);
  });

  it("sin categorías reconocibles completa con objetos genéricos", () => {
    expect(shelfFor([])).toEqual(["bag", "tag", "box"]);
    expect(shelfFor(["Destacados", "Novedades"])).toEqual(["bag", "tag", "box"]);
  });
});
