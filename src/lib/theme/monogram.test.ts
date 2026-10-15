import { describe, expect, it } from "vitest";

import { monogramInitial, monogramSvg } from "./monogram";

describe("monograma de la tienda", () => {
  it("toma la primera letra o número del nombre", () => {
    expect(monogramInitial("  ñandú nutrición")).toBe("Ñ");
    expect(monogramInitial("¡Fuerza Total!")).toBe("F");
    expect(monogramInitial("360 Sport")).toBe("3");
    expect(monogramInitial("<script>")).toBe("S");
    expect(monogramInitial("🔥")).toBe("•");
  });

  it("solo colores de la lista blanca y nada inyectable", () => {
    const svg = monogramSvg('"><script>alert(1)</script>', 'red" onload="x', "#ffffff");
    expect(svg).not.toMatch(/script|onload|alert/);
    expect(svg).toContain('fill="#111827"');
    expect(svg).toContain(">S</text>");
  });
});
