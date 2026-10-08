import { describe, expect, it } from "vitest";

import { formatAttributes, formatNutrition, parseAttributes, parseNutrition } from "./compact";

describe("tabla nutrimental compacta", () => {
  const rows = [
    { name: "Omega 3", amount: "1000", unit: "mg" },
    { name: "EPA", amount: "180" },
    { name: "Zinc", amount: "11", dv: "100%" },
  ];

  it("ida y vuelta", () => {
    const text = formatNutrition(rows);
    expect(text).toBe("Omega 3|1000|mg; EPA|180; Zinc|11||100%");
    expect(parseNutrition(text)).toEqual({ ok: true, value: rows });
  });

  it("acepta espacios y renglones vacíos; la celda vacía es una tabla vacía", () => {
    expect(parseNutrition("  Omega 3 | 1000 | mg ;; ")).toEqual({
      ok: true,
      value: [{ name: "Omega 3", amount: "1000", unit: "mg" }],
    });
    expect(parseNutrition("")).toEqual({ ok: true, value: [] });
  });

  it("explica el renglón con error", () => {
    expect(parseNutrition("Omega 3|1000; EPA")).toEqual({
      ok: false,
      error: "Renglón 2: falta el nombre o la cantidad.",
    });
    expect(parseNutrition("A|1|mg|10%|extra").ok).toBe(false);
  });
});

describe("atributos compactos", () => {
  it("ida y vuelta con las claves de la URL", () => {
    const attributes = [
      { key: "objetivo", values: ["energia", "masa-muscular"] },
      { key: "sabor", values: ["chocolate"] },
      { key: "origen", values: [] },
    ];
    const text = formatAttributes(attributes);
    expect(text).toBe("objetivo:energia|masa-muscular; sabor:chocolate");
    expect(parseAttributes(text)).toEqual({
      ok: true,
      value: { objetivo: ["energia", "masa-muscular"], sabor: ["chocolate"] },
    });
    expect(parseAttributes(" ")).toEqual({ ok: true, value: {} });
  });

  it("rechaza nombres en lugar de claves, claves repetidas o sin valores", () => {
    expect(parseAttributes("Objetivo:Energía").ok).toBe(false);
    expect(parseAttributes("objetivo").ok).toBe(false);
    expect(parseAttributes("objetivo:energia; objetivo:fuerza")).toEqual({
      ok: false,
      error: "El atributo «objetivo» está repetido.",
    });
  });
});
