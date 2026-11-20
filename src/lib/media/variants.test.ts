import { describe, expect, it } from "vitest";

import {
  buildSrcSet,
  variantPath,
  variantWidthsFor,
  logoSizes,
  smallVariantPath,
} from "./variants";

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

describe("fotos que se ven chicas", () => {
  it("la copia de 320 px para miniaturas; sin copias o más chica, la original", () => {
    const p = "s/a/original.jpg";
    expect(smallVariantPath(p, 1168)).toBe("s/a/original.jpg.w320.webp");
    expect(smallVariantPath(p, 300)).toBe(p);
    expect(smallVariantPath(p, null)).toBe(p);
    expect(smallVariantPath("s/a/logo.png", 1168)).toBe("s/a/logo.png");
  });

  it("el logo pide solo el ancho con que se ve en el encabezado", () => {
    expect(logoSizes(1168, 784)).toBe("84px");
    expect(logoSizes(1600, 400)).toBe("176px");
    expect(logoSizes(null, null)).toBe("168px");
  });
});
