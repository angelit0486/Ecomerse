import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

import { LOOK_FONTS, lookCss, NOCTURNO, NOCTURNO_PAIRS, STORE_LOOKS, storeLook } from "./looks";
import { FONT_KEYS } from "./schema";

describe("temas de presentación (looks)", () => {
  it("solo una clave conocida enciende un look; las demás no cambian nada", () => {
    expect(storeLook("nocturno")).toBe("nocturno");
    for (const key of ["base", "", "Nocturno", "nocturno ", "anaquel", null, undefined, 1, {}]) {
      expect(storeLook(key)).toBeNull();
    }
  });

  it("las claves caben en la validación de la base (store_themes.theme_key)", () => {
    for (const key of STORE_LOOKS) expect(key).toMatch(/^[a-z][a-z0-9_]{1,30}$/);
  });

  it("solo usa fuentes de la lista curada", () => {
    for (const key of STORE_LOOKS) {
      for (const font of LOOK_FONTS[key]) expect(FONT_KEYS).toContain(font);
    }
  });

  it.each(NOCTURNO_PAIRS.map(([name, fg, bg, min]) => [name, fg, bg, min] as const))(
    "Nocturno: %s llega al contraste mínimo",
    (_, fg, bg, min) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
    },
  );

  it("el CSS es fijo: solo mira su atributo y no lleva valores de la tienda ni código", () => {
    const css = lookCss("nocturno");
    // Toda regla va bajo la raíz del look (o es una regla @ o el fondo de <html>).
    for (const rule of css.split("}").filter((r) => r.includes("{"))) {
      const selector = rule.slice(0, rule.indexOf("{")).trim();
      if (selector.startsWith("@") || /^(from|to|\d+%)$/.test(selector)) continue;
      expect(selector).toContain(".sf-root[data-look='nocturno']");
    }
    expect(css).not.toMatch(/<\/?style|javascript:|expression\(|url\(|@import/i);
    // La paleta del look es la del brief (sin colores sueltos fuera de ella).
    for (const hex of css.match(/#[0-9a-f]{6}/gi) ?? []) {
      expect(Object.values(NOCTURNO)).toContain(hex.toLowerCase());
    }
  });

  it("todo el movimiento respeta «reducir movimiento»", () => {
    const css = lookCss("nocturno");
    const outside = css.replace(/@media \(prefers-reduced-motion:no-preference\)\{.*?\}\}+/g, "");
    expect(outside).not.toMatch(/animation:|animation-timeline/);
  });
});
