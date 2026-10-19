import { describe, expect, it } from "vitest";

import { COMPRESS_MAX_SIDE, fitWithin, runPool, webpName } from "./compress";

describe("fitWithin", () => {
  it("no agranda imágenes pequeñas", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("reduce el lado mayor al máximo conservando la proporción", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: COMPRESS_MAX_SIDE, height: 1800 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1200, height: COMPRESS_MAX_SIDE });
  });

  it("nunca devuelve cero", () => {
    expect(fitWithin(100_000, 1, 2400)).toEqual({ width: 2400, height: 1 });
  });
});

describe("webpName", () => {
  it("cambia solo la última extensión", () => {
    expect(webpName("PRV-001.jpg")).toBe("PRV-001.webp");
    expect(webpName("foto.final.PNG")).toBe("foto.final.webp");
    expect(webpName("sin-extension")).toBe("sin-extension.webp");
  });
});

describe("runPool", () => {
  it("respeta el límite de concurrencia y el orden de los resultados", async () => {
    let active = 0;
    let peak = 0;
    const results = await runPool([5, 1, 4, 2, 3], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active -= 1;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it("con una lista vacía no hace nada", async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([]);
  });
});
