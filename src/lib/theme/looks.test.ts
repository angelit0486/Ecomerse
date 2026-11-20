import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

import {
  LOOK_FONTS,
  lookCss,
  lookStoreName,
  NOCTURNO,
  NOCTURNO_PAIRS,
  STORE_LOOKS,
  storeLook,
  withLookName,
} from "./looks";
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

  it("conserva la colorimetría de Alien Demon: verde para la acción, morado de acento", () => {
    // Colores de la marca guardados en Apariencia de la tienda (primario y acento).
    expect(NOCTURNO.alien).toBe("#00a303");
    expect(NOCTURNO.violet).toBe("#b200ff");
    const css = lookCss("nocturno");
    expect(css).toContain(`--sf-btn-bg:${NOCTURNO.alien}`);
    expect(css).toContain(`--sf-primary:${NOCTURNO.alien}`);
    expect(css).toContain(`.sf-hero-cta{background:${NOCTURNO.alien}`);
    expect(css).toContain(`--sf-sale-bg:${NOCTURNO.violet};--sf-sale-fg:${NOCTURNO.white}`);
  });

  it("el nombre con letras decorativas de Unicode se dibuja con letras normales", () => {
    expect(lookStoreName("𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 𝓔𝓧𝓞𝓣𝓘𝓒𝓢 |")).toBe("ALIEN DEMON EXOTICS");
    expect(lookStoreName("Café Ñandú")).toBe("Café Ñandú");
    expect(lookStoreName("Tienda — ")).toBe("Tienda");
    // Si solo hubiera separadores, se conserva el nombre guardado.
    expect(lookStoreName("|")).toBe("|");
  });

  it("con look, el nombre en letras normales llega a toda la tienda; sin look, intacto", () => {
    const fancy = "𝓐𝓛𝓘𝓔𝓝 𝓓𝓔𝓜𝓞𝓝 |";
    expect(withLookName({ name: fancy, theme: { key: "nocturno" } }).name).toBe("ALIEN DEMON");
    const base = { name: fancy, theme: { key: "base" } };
    expect(withLookName(base)).toBe(base);
    expect(withLookName({ name: fancy }).name).toBe(fancy);
  });

  it("tipografía editorial y categorías redondas, sin numeración ni flechas decorativas", () => {
    expect(LOOK_FONTS.nocturno).toEqual(["barlow-condensed", "manrope"]);
    const css = lookCss("nocturno");
    expect(css).toContain("--sf-font-heading:var(--font-barlow-condensed)");
    expect(css).toMatch(/\.sf-cat-media\{aspect-ratio:1;border-radius:50%/);
    // Sin numeración decorativa de secciones (solo los pasos de un aviso, que sí son secuencia).
    expect(css).not.toContain("ad-sec");
    expect(css).not.toContain("→");
    expect(css).not.toContain("space-grotesk");
  });

  it("en el checkout, la forma de pago elegida se enciende (regla :checked propia)", () => {
    const css = lookCss("nocturno");
    expect(css).toContain("[name=shipping_rate_id]):checked){border-color:");
  });

  it("ningún filtro en el encabezado atrapa al menú fijo del celular", () => {
    // backdrop-filter, filter o transform en un ancestro vuelven a ese ancestro el
    // contenedor de sus hijos «fixed»: el menú del celular quedaba encerrado en el
    // encabezado en lugar de cubrir la pantalla.
    const css = lookCss("nocturno");
    expect(css).not.toMatch(
      /header\.sf-el-header(:not\(\.sticky\))?\{[^}]*(backdrop-filter|[^-]filter:|transform:)/,
    );
  });

  it("de otro mundo: la inclinación de cartas y el anillo de planeta solo existen con mouse", () => {
    const css = lookCss("nocturno");
    expect(css).toContain("@keyframes ad-beam");
    // En pantallas táctiles no hay «hover»: un efecto fuera de este bloque se quedaría pegado.
    const touch = css.replace(/@media \(hover:hover\) and \(pointer:fine\)[^{]*\{.*?\}\}/g, "");
    expect(touch).not.toContain("perspective(");
    expect(touch).not.toContain(".sf-cat-link::before");
  });

  it("el cielo no se repinta al desplazarse: capa fija propia, sin background-attachment:fixed", () => {
    const css = lookCss("nocturno");
    // background-attachment:fixed obliga a repintar todo el fondo en cada scroll.
    expect(css).not.toContain("background-attachment:fixed");
    expect(css).toMatch(
      /\.sf-root\[data-look='nocturno'\]::before\{content:"";position:fixed;inset:0;z-index:-1/,
    );
  });

  it("todo el movimiento respeta «reducir movimiento»", () => {
    const css = lookCss("nocturno");
    const outside = css.replace(/@media \(prefers-reduced-motion:no-preference\)\{.*?\}\}+/g, "");
    expect(outside).not.toMatch(/animation:|animation-timeline/);
  });
});
