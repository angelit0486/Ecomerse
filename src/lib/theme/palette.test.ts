import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

import {
  buttonTextColor,
  contrastIssues,
  DEFAULT_COLORS,
  resolvePalette,
  suggestContrastFix,
} from "./palette";

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

describe("suggestContrastFix (ADR-034)", () => {
  it("oscurece un color claro sobre fondo blanco hasta 4.5:1, conservando el tono", () => {
    const fixed = suggestContrastFix("#7dd3fc", "#ffffff", 4.5);
    expect(contrastRatio(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // Sigue siendo azulado: el azul domina sobre el rojo.
    expect(Number.parseInt(fixed.slice(5, 7), 16)).toBeGreaterThan(
      Number.parseInt(fixed.slice(1, 3), 16),
    );
  });

  it("aclara sobre fondo oscuro y deja igual lo que ya cumple", () => {
    expect(
      contrastRatio(suggestContrastFix("#333333", "#111111", 4.5), "#111111"),
    ).toBeGreaterThanOrEqual(4.5);
    expect(suggestContrastFix("#111827", "#ffffff", 4.5)).toBe("#111827");
  });
});
