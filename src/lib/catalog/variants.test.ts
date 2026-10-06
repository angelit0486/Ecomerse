import { describe, expect, it } from "vitest";

import { generateCombinations, selectionLabel, signatureOf } from "./variants";

const playera = [
  { name: "Color", values: ["Negro", "Blanco"] },
  { name: "Talla", values: ["CH", "M", "G"] },
];

describe("generador de variantes", () => {
  it("la Playera: 2 colores × 3 tallas = 6 combinaciones en orden", () => {
    const combos = generateCombinations(playera);
    expect(combos).toHaveLength(6);
    expect(combos[0]).toEqual({ Color: "Negro", Talla: "CH" });
    expect(combos[5]).toEqual({ Color: "Blanco", Talla: "G" });
  });

  it("sin opciones: un producto simple (una combinación vacía)", () => {
    expect(generateCombinations([])).toEqual([{}]);
  });

  it("ignora valores vacíos y repetidos", () => {
    expect(generateCombinations([{ name: "Color", values: ["Rojo", " ", "Rojo"] }])).toEqual([
      { Color: "Rojo" },
    ]);
  });

  it("firma igual a la de la base", () => {
    expect(signatureOf(playera, { Talla: "M", Color: "Negro" })).toBe("Color=Negro|Talla=M");
    expect(signatureOf([], {})).toBe("");
    expect(selectionLabel(playera, { Color: "Negro", Talla: "M" })).toBe("Negro / M");
  });
});
