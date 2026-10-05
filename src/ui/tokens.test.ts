import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
);

function color(name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Token --color-${name} no encontrado`);
  return value;
}

// WCAG 2.2 AA: texto 4.5:1 (1.4.3); bordes de controles y foco 3:1 (1.4.11).
const pairs: Array<[string, string, number]> = [
  ["fg", "surface", 4.5],
  ["fg", "canvas", 4.5],
  ["fg-muted", "surface", 4.5],
  ["fg-muted", "canvas", 4.5],
  ["accent-fg", "accent", 4.5],
  ["accent-fg", "accent-hover", 4.5],
  ["accent", "surface", 4.5],
  ["danger", "surface", 4.5],
  ["danger-fg", "danger", 4.5],
  ["success", "surface", 4.5],
  ["warning", "surface", 4.5],
  ["control", "surface", 3],
  ["control", "canvas", 3],
  ["focus", "surface", 3],
  ["focus", "canvas", 3],
];

describe("design tokens", () => {
  it.each(pairs)("%s sobre %s cumple contraste ≥ %s:1", (fg, bg, min) => {
    expect(contrastRatio(color(fg), color(bg))).toBeGreaterThanOrEqual(min);
  });

  it("contrastRatio coincide con valores de referencia WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(() => contrastRatio("red", "#ffffff")).toThrow();
  });
});
