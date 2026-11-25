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

  it("dirección «Alien Demon Exotics»: púrpura para la acción, verde neón solo como estado", () => {
    // Paleta de la dirección creativa (2026-11-24): negro espacial domina, púrpura
    // eléctrico da identidad y acción, verde neón como acento limitado.
    expect(NOCTURNO.void).toBe("#07060b");
    expect(NOCTURNO.deep).toBe("#120b1f");
    expect(NOCTURNO.action).toBe("#8a2bff");
    expect(NOCTURNO.glow).toBe("#b266ff");
    expect(NOCTURNO.neon).toBe("#39ff14");
    expect(NOCTURNO.frost).toBe("#f6f5fa");
    const css = lookCss("nocturno");
    expect(css).toContain(`--sf-btn-bg:${NOCTURNO.action};--sf-btn-fg:${NOCTURNO.white}`);
    expect(css).toContain(`--sf-primary:${NOCTURNO.action}`);
    expect(css).toContain(`.sf-hero-cta{background:${NOCTURNO.action};color:${NOCTURNO.white}`);
    expect(css).toContain(`--sf-sale-bg:${NOCTURNO.violet};--sf-sale-fg:${NOCTURNO.white}`);
    // El verde neón aparece en pocos lugares, todos de estado (reloj del corte,
    // cuenta del pedido, íconos de confianza): nunca como relleno de botón.
    const neon = css.split(NOCTURNO.neon).length - 1;
    expect(neon).toBeGreaterThan(0);
    expect(neon).toBeLessThanOrEqual(4);
    expect(css).not.toMatch(new RegExp(`background:${NOCTURNO.neon}`));
  });

  it("los letreros de la marca van en cromo, con respaldo legible sin soporte", () => {
    const css = lookCss("nocturno");
    expect(css).toMatch(
      /@supports \(\(-webkit-background-clip:text\) or \(background-clip:text\)\)\{[^}]*:is\(\.sf-hero-title,\.sf-footer-name\)\{background:linear-gradient\(/,
    );
    // Fuera del @supports, título y nombre del pie tienen color sólido (blanco frío).
    expect(css).toContain(`max-width:14ch;color:${NOCTURNO.frost}}`);
    expect(css).toMatch(new RegExp(`\\.sf-footer-name\\{[^}]*color:${NOCTURNO.frost}\\}`));
  });

  it("la página activa de la barra de categorías se distingue sin depender solo del color", () => {
    const css = lookCss("nocturno");
    expect(css).toContain("--sf-nav-active:");
    // El subrayado (forma) acompaña al color.
    expect(css).toContain("nav[aria-label='Categorías'] a[aria-current=page]{color:");
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
    expect(LOOK_FONTS.nocturno).toEqual(["space-grotesk", "inter"]);
    const css = lookCss("nocturno");
    expect(css).toContain("--sf-font-heading:var(--font-space-grotesk)");
    expect(css).not.toMatch(/barlow|manrope/);
    // Titulares en caja normal: las mayúsculas quedan para rótulos chicos (≤ 1rem).
    for (const m of css.matchAll(/font:\d{3} ([\d.]+)rem[^}]*text-transform:uppercase/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(1);
    }
    expect(css).toMatch(/\.sf-cat-media\{aspect-ratio:1;border-radius:50%/);
    // Sin numeración decorativa de secciones (solo los pasos de un aviso, que sí son secuencia).
    expect(css).not.toContain("ad-sec");
    expect(css).not.toContain("→");
  });

  it("páginas informativas legibles; ruta y «Saltar al contenido» con la marca", () => {
    const css = lookCss("nocturno");
    // Subtítulos separados por un filo y viñetas en púrpura luminoso.
    expect(css).toContain(
      "article > .sf-prose > :is(h2,h3){margin-top:2.25rem;padding-top:1.5rem;border-top:",
    );
    expect(css).toContain(`article > .sf-prose li::marker{color:${NOCTURNO.glow}}`);
    // La página actual de la ruta se distingue por peso, no solo por color.
    expect(css).toMatch(
      /nav\[aria-label='Ruta de navegación'\] \[aria-current=page\]\{[^}]*font-weight:600/,
    );
    // El salto al contenido visible al enfocarlo, en el púrpura de acción con texto blanco.
    expect(css).toContain(
      `a[href='#contenido']:focus{background:${NOCTURNO.action};color:${NOCTURNO.white}`,
    );
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
