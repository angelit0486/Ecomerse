import { describe, expect, it } from "vitest";

import { generateCombinations } from "./variants";
import { matchDrafts, renameOptionKey, renameOptionValue } from "./variant-drafts";

const draft = (options: Record<string, string>, sku: string) => ({ options, sku });

describe("matchDrafts", () => {
  it("la variante única pasa a la primera combinación al agregar una opción", () => {
    const combos = generateCombinations([{ name: "Color", values: ["Rojo", "Azul"] }]);
    expect(matchDrafts(combos, ["Color"], [draft({}, "GOR-1")])).toEqual([0, -1]);
  });

  it("agregar una segunda opción conserva las variantes por su primer valor", () => {
    const drafts = [draft({ Color: "Negro" }, "N"), draft({ Color: "Blanco" }, "B")];
    const combos = generateCombinations([
      { name: "Color", values: ["Negro", "Blanco"] },
      { name: "Talla", values: ["CH", "M"] },
    ]);
    const matched = matchDrafts(combos, ["Color", "Talla"], drafts);
    expect(matched).toEqual([0, -1, 1, -1]); // Negro/CH ← N, Blanco/CH ← B
  });

  it("exactas primero, sin mayúsculas, y cada borrador una sola vez", () => {
    const drafts = [draft({ color: "negro" }, "N")];
    const combos = generateCombinations([{ name: "Color", values: ["Blanco", "Negro"] }]);
    expect(matchDrafts(combos, ["Color"], drafts)).toEqual([-1, 0]);
  });

  it("no empareja valores contradictorios", () => {
    const combos = generateCombinations([{ name: "Color", values: ["Verde"] }]);
    expect(matchDrafts(combos, ["Color"], [draft({ Color: "Rojo" }, "R")])).toEqual([-1]);
  });
});

describe("renombrar", () => {
  it("renombrar la opción y un valor mantiene el emparejamiento exacto", () => {
    let drafts = [draft({ Color: "Negro" }, "N")];
    drafts = renameOptionKey(drafts, "Color", "Tono");
    drafts = renameOptionValue(drafts, "Tono", "Negro", "Carbón");
    expect(drafts[0]!.options).toEqual({ Tono: "Carbón" });
    const combos = generateCombinations([{ name: "Tono", values: ["Carbón"] }]);
    expect(matchDrafts(combos, ["Tono"], drafts)).toEqual([0]);
  });
});
