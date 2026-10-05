import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

import { buttonTextColor, contrastIssues, DEFAULT_COLORS, resolvePalette } from "./palette";

describe("paleta de tienda", () => {
  it("la paleta por defecto cumple todas las reglas", () => {
    expect(contrastIssues(DEFAULT_COLORS)).toEqual([]);
  });

  it("completa una paleta parcial con los valores por defecto", () => {
    expect(resolvePalette({ primary: "#0f766e" })).toEqual({
      ...DEFAULT_COLORS,
      primary: "#0f766e",
    });
  });

  it("detecta texto ilegible y botones que no se distinguen del fondo", () => {
    const issues = contrastIssues(resolvePalette({ foreground: "#aaaaaa", primary: "#ffff00" }));
    expect(issues.map((i) => i.key)).toEqual(["foreground", "primary"]);
    expect(issues[0]!.required).toBe(4.5);
  });

  it("el texto del botón siempre alcanza 4.5:1", () => {
    for (const primary of ["#808080", "#767676", "#1d4ed8", "#fde68a", "#000000", "#ffffff"]) {
      expect(contrastRatio(buttonTextColor(primary), primary)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
