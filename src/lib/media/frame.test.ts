import { describe, expect, it } from "vitest";

import { fitRect } from "./frame";

describe("fitRect", () => {
  it("completo: un logo horizontal queda entero y centrado en el cuadro", () => {
    expect(fitRect(1000, 500, 512, 512, "contain")).toEqual({ x: 0, y: 128, w: 512, h: 256 });
  });

  it("llenar: se recorta al centro", () => {
    expect(fitRect(1000, 500, 512, 512, "cover")).toEqual({ x: -256, y: 0, w: 1024, h: 512 });
  });

  it("portada 1600×600 desde una foto vertical", () => {
    expect(fitRect(600, 900, 1600, 600, "cover")).toEqual({ x: 0, y: -900, w: 1600, h: 2400 });
  });
});
