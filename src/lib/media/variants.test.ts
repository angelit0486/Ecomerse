import { describe, expect, it } from "vitest";

import { buildSrcSet, variantPath, variantWidthsFor } from "./variants";

const url = (p: string) => `https://cdn.test/${p}`;

describe("variantes de imagen", () => {
  it("solo anchos menores que el original", () => {
    expect(variantWidthsFor(1000)).toEqual([320, 640, 960]);
    expect(variantWidthsFor(320)).toEqual([]);
    expect(variantWidthsFor(null)).toEqual([]);
  });

  it("ruta junto al archivo publicado", () => {
    expect(variantPath("s/product/p/m/original.jpg", 640)).toBe(
      "s/product/p/m/original.jpg.w640.webp",
    );
  });

  it("srcset con copias y original; null si no hay copias", () => {
    expect(buildSrcSet(url, "s/original.jpg", 700)).toBe(
      "https://cdn.test/s/original.jpg.w320.webp 320w, https://cdn.test/s/original.jpg.w640.webp 640w, https://cdn.test/s/original.jpg 700w",
    );
    expect(buildSrcSet(url, "s/original.jpg", 300)).toBeNull();
    expect(buildSrcSet(url, "s/original.jpg", null)).toBeNull();
    // Ruta no canónica: el worker no le hace copias, así que no se piden.
    expect(buildSrcSet(url, "s/display.webp", 800)).toBeNull();
  });
});
