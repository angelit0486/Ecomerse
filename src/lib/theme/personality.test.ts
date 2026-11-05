import { describe, expect, it } from "vitest";

import { PERSONALITY_OPTIONS } from "./constants";
import { PERSONALITY_CSS, personalityAttributes, readPersonality } from "./personality";
import { ThemeSettingsV2 } from "./schema";

describe("personalidad del diseño (tema v5, ADR-063)", () => {
  it("sin personalidad no agrega ningún atributo: la tienda se ve como hoy", () => {
    expect(personalityAttributes(undefined, { cardColors: false })).toEqual({});
    expect(personalityAttributes({}, { cardColors: false })).toEqual({});
  });

  it("los valores de hoy tampoco agregan atributos", () => {
    expect(
      personalityAttributes(
        {
          card_style: "outlined",
          image_ratio: "1:1",
          image_fit: "contain",
          card_hover: "zoom",
          card_align: "start",
          heading_case: "normal",
          heading_tracking: "normal",
          type_scale: "normal",
          motion: "none",
        },
        { cardColors: false },
      ),
    ).toEqual({});
  });

  it("cada opción se vuelve un atributo con un valor de la lista", () => {
    expect(
      personalityAttributes(
        {
          card_style: "flat",
          image_ratio: "4:5",
          image_fit: "cover",
          card_hover: "lift",
          card_align: "center",
          heading_case: "uppercase",
          heading_tracking: "wide",
          heading_weight: "regular",
          type_scale: "large",
          motion: "subtle",
        },
        { cardColors: false },
      ),
    ).toEqual({
      "data-card": "flat",
      "data-ratio": "4:5",
      "data-fit": "cover",
      "data-hover": "lift",
      "data-align": "center",
      "data-hcase": "upper",
      "data-htrack": "wide",
      "data-hweight": "regular",
      "data-scale": "large",
      "data-motion": "subtle",
    });
  });

  it("una tarjeta plana con fondo propio conserva su margen interior", () => {
    expect(personalityAttributes({ card_style: "flat" }, { cardColors: true })).toEqual({
      "data-card": "flat",
      "data-card-bg": "",
    });
    expect(personalityAttributes({ card_style: "raised" }, { cardColors: true })).toEqual({
      "data-card": "raised",
    });
  });

  it("ignora lo que no está en la lista (aunque llegue sin validar)", () => {
    expect(
      readPersonality({
        card_style: "neon",
        image_ratio: "16:9",
        heading_weight: "900",
        motion: true,
        css: "body{display:none}",
      }),
    ).toEqual({});
    expect(personalityAttributes("flat", { cardColors: false })).toEqual({});
    expect(personalityAttributes({ card_style: "x'];*{}" }, { cardColors: false })).toEqual({});
  });

  it("el esquema y la lista blanca aceptan exactamente los mismos valores", () => {
    for (const [key, options] of Object.entries(PERSONALITY_OPTIONS)) {
      for (const value of options) {
        expect(ThemeSettingsV2.safeParse({ personality: { [key]: value } }).success).toBe(true);
        expect(readPersonality({ [key]: value })).toEqual({ [key]: value });
      }
      expect(ThemeSettingsV2.safeParse({ personality: { [key]: "otro" } }).success).toBe(false);
    }
  });

  it("el CSS es fijo: solo mira atributos de la raíz y respeta «reducir movimiento»", () => {
    expect(PERSONALITY_CSS).not.toMatch(/url\(|@import|expression|javascript:/i);
    // Toda animación o transición vive dentro de «sin preferencia de reducir movimiento».
    const motion = PERSONALITY_CSS.split("@media (prefers-reduced-motion:no-preference){");
    expect(motion).toHaveLength(3);
    expect(motion[0]).not.toMatch(/animation:|transition:/);
    expect(PERSONALITY_CSS).toContain("@supports (animation-timeline:view())");
    // Cada regla empieza en la raíz de la tienda (nada fuera de `.sf-root`).
    const selectors = PERSONALITY_CSS.replace(/@keyframes sf-rise\{[^}]*\}[^}]*\}/, "")
      .replace(/@media[^{]*\{|@supports[^{]*\{/g, "")
      .split("}")
      .map((r) => r.split("{")[0]!.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) expect(selector.startsWith(".sf-root")).toBe(true);
  });
});
