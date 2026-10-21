import { describe, expect, it } from "vitest";

import { DEFAULT_COLORS } from "./palette";
import { contrastRatio } from "@/lib/color/contrast";

import { THEME_PRESETS } from "./presets";
import {
  announcementActive,
  footerColors,
  linkColor,
  photoBlend,
  resolveTheme,
  saleColors,
  STATE_COLORS,
  stateColors,
  themeCss,
} from "./resolve-theme";

describe("resolveTheme", () => {
  it("sin tema: defaults", () => {
    const theme = resolveTheme(undefined);
    expect(theme.palette).toEqual(DEFAULT_COLORS);
    expect(theme.radius).toBe("8px");
    expect(theme.buttonStyle).toBe("solid");
  });

  it("aplica colores y forma válidos", () => {
    const theme = resolveTheme({
      colors: { primary: "#000000" },
      shape: { radius: "full", button_style: "outline" },
    });
    expect(theme.palette.primary).toBe("#000000");
    expect(theme.buttonText).toBe("#ffffff");
    expect(theme.radius).toBe("9999px");
    expect(theme.buttonStyle).toBe("outline");
  });

  it("descarta cualquier valor fuera de la lista blanca (sin inyección de CSS)", () => {
    const theme = resolveTheme({
      colors: {
        primary: "red;}body{display:none",
        background: "url(javascript:alert(1))",
        muted: "#12345",
      },
      shape: { radius: "1px;}*{x:y", shadow: "0 0 0 red;}*{x:y", density: "9rem" },
    });
    expect(theme.palette).toEqual(DEFAULT_COLORS);
    const css = themeCss(theme);
    expect(css).not.toMatch(/[{}<>]|url\(|;;/);
    expect(
      css
        .split(";")
        .every((d) =>
          /^--sf-[a-z-]+:(#[0-9a-f]{6}|\d+px|\d+(\.\d+)?rem|none|multiply|normal|var\(--font-[a-z-]+\))$/.test(
            d,
          ),
        ),
    ).toBe(true);
  });

  it("sombra y densidad solo de su lista (tema v2, ADR-034)", () => {
    const soft = themeCss(resolveTheme({ shape: { shadow: "soft", density: "spacious" } }));
    expect(soft).toContain("--sf-shadow-card:0 1px 2px rgb(0 0 0 / 0.06)");
    expect(soft).toContain("--sf-section-gap:4rem");
    const plain = themeCss(resolveTheme({}));
    expect(plain).toContain("--sf-shadow-card:none");
    expect(plain).toContain("--sf-section-gap:3rem;--sf-section-gap-lg:4rem");
  });

  it("anuncio con vigencia: se muestra solo entre sus fechas", () => {
    const theme = resolveTheme({
      header: {
        announcement: {
          text: "Buen Fin",
          background: "#111827",
          foreground: "#ffffff",
          starts_at: "2026-11-13T00:00:00-06:00",
          ends_at: "2026-11-17T23:59:59-06:00",
        },
      },
    });
    expect(announcementActive(theme.announcement, new Date("2026-11-12T23:00:00-06:00"))).toBe(
      false,
    );
    expect(announcementActive(theme.announcement, new Date("2026-11-14T12:00:00-06:00"))).toBe(
      true,
    );
    expect(announcementActive(theme.announcement, new Date("2026-11-18T00:00:00-06:00"))).toBe(
      false,
    );
    expect(announcementActive(null)).toBe(false);
  });

  it("fuentes solo de la lista curada; cualquier otra cae en la de por defecto", () => {
    const theme = resolveTheme({ typography: { heading: "oswald", body: "x);}*{y:z" } });
    expect(theme.fonts).toEqual({ heading: "oswald", body: "inter" });
    expect(themeCss(theme)).toContain("--sf-font-heading:var(--font-oswald)");
    expect(themeCss(theme)).toContain("--sf-font-body:var(--font-inter)");
  });

  it("botón de contorno: fondo de la página, texto y borde primary", () => {
    const css = themeCss(
      resolveTheme({ colors: { primary: "#0f766e" }, shape: { button_style: "outline" } }),
    );
    expect(css).toContain("--sf-btn-bg:#ffffff");
    expect(css).toContain("--sf-btn-fg:#0f766e");
    expect(css).toContain("--sf-btn-border:#0f766e");
  });

  it("barra de anuncio solo con texto y colores válidos", () => {
    const ok = resolveTheme({
      header: {
        announcement: { text: "Envío gratis", background: "#111827", foreground: "#ffffff" },
      },
    });
    expect(ok.announcement).toEqual({
      text: "Envío gratis",
      link: null,
      background: "#111827",
      foreground: "#ffffff",
      startsAt: null,
      endsAt: null,
    });
    expect(themeCss(ok)).toContain("--sf-announce-bg:#111827");
    const bad = resolveTheme({
      header: { announcement: { text: "x", background: "red", foreground: "#ffffff" } },
    });
    expect(bad.announcement).toBeNull();
    expect(themeCss(bad)).not.toContain("announce");
  });
});

describe("saleColors (revisión de conversión, M8)", () => {
  it("el acento con 4.5:1 para su texto pinta la oferta y el ahorro", () => {
    const sale = saleColors(resolveTheme({ colors: { accent: "#9a3412" } }));
    expect(sale).toEqual({ bg: "#9a3412", fg: "#ffffff", text: "#9a3412" });
  });

  it("un acento claro no se usa donde no llega a 4.5:1", () => {
    const theme = resolveTheme({ colors: { primary: "#0b5d4b", accent: "#f59e0b" } });
    const sale = saleColors(theme);
    // Sobre ámbar el texto negro sí llega: la insignia lo usa; el texto «Ahorras» no.
    expect(sale.bg).toBe("#f59e0b");
    expect(contrastRatio(sale.fg, sale.bg)).toBeGreaterThanOrEqual(4.5);
    expect(sale.text).toBe(theme.palette.foreground);
  });

  it("siempre con contraste ≥ 4.5:1, y en la lista blanca del CSS", () => {
    for (const accent of ["#777777", "#808080", "#b45309", "#ffffff", "#000000"]) {
      const theme = resolveTheme({ colors: { accent } });
      const sale = saleColors(theme);
      expect(contrastRatio(sale.fg, sale.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(sale.text, theme.palette.background)).toBeGreaterThanOrEqual(4.5);
      expect(themeCss(theme)).toContain(`--sf-sale-bg:${sale.bg}`);
    }
  });
});

describe("saleColors con acento de tono medio (PRUVA, 2026-10-19)", () => {
  it("PRUVA: insignia azul marino con blanco y texto de oferta azul marino", () => {
    const pruva = THEME_PRESETS.find((p) => p.key === "pruva")!;
    const theme = resolveTheme({ colors: pruva.colors });
    expect(saleColors(theme)).toEqual({ bg: "#0b2d5b", fg: "#ffffff", text: "#0b2d5b" });
    expect(contrastRatio("#ffffff", "#0b2d5b")).toBeGreaterThanOrEqual(4.5);
  });

  it("los demás estilos sugeridos no cambian (acento con texto blanco)", () => {
    const expected: Record<string, { bg: string; fg: string; text: string }> = {
      anaquel: { bg: "#d62d20", fg: "#ffffff", text: "#d62d20" },
      deportivo: { bg: "#b4500c", fg: "#ffffff", text: "#b4500c" },
      neutral: { bg: "#b42318", fg: "#ffffff", text: "#b42318" },
      grafito: { bg: "#a3471a", fg: "#ffffff", text: "#a3471a" },
    };
    for (const [key, value] of Object.entries(expected)) {
      const preset = THEME_PRESETS.find((p) => p.key === key)!;
      expect(saleColors(resolveTheme({ colors: preset.colors }))).toEqual(value);
    }
  });

  it("con botones de contorno el acento de tono medio conserva la regla anterior", () => {
    const theme = resolveTheme({
      colors: { accent: "#4f7ea8", background: "#f6f8fb", primary: "#0b2d5b" },
      shape: { button_style: "outline" },
    });
    expect(saleColors(theme)).toEqual({
      bg: "#4f7ea8",
      fg: "#000000",
      text: theme.palette.foreground,
    });
  });
});

describe("footerColors (rediseño A+B)", () => {
  it("el primario oscurecido con texto blanco, o el tema invertido si el primario es claro", () => {
    expect(footerColors(resolveTheme({ colors: { primary: "#1d3fd1" } }))).toEqual({
      bg: "#132988",
      fg: "#ffffff",
    });
    const light = resolveTheme({ colors: { primary: "#f5c400" } });
    expect(footerColors(light)).toEqual({
      bg: light.palette.foreground,
      fg: light.palette.background,
    });
  });

  it("siempre con contraste ≥ 4.5:1, y en la lista blanca del CSS", () => {
    for (const primary of ["#777777", "#808080", "#1d3fd1", "#ffffff", "#000000", "#0b5d4b"]) {
      const theme = resolveTheme({ colors: { primary } });
      const footer = footerColors(theme);
      expect(contrastRatio(footer.fg, footer.bg)).toBeGreaterThanOrEqual(4.5);
      expect(themeCss(theme)).toContain(`--sf-footer-bg:${footer.bg}`);
    }
  });
});

describe("linkColor (rediseño A+B)", () => {
  it("el primario si llega a 4.5:1 sobre el fondo; si no, el color de texto", () => {
    expect(linkColor(resolveTheme({ colors: { primary: "#1d3fd1" } }))).toBe("#1d3fd1");
    // Botones rellenos: el tema acepta un primario de 3:1, que como texto no basta.
    const soft = resolveTheme({ colors: { primary: "#2f9e8f" } });
    expect(contrastRatio(soft.palette.primary, soft.palette.background)).toBeLessThan(4.5);
    expect(linkColor(soft)).toBe(soft.palette.foreground);
    expect(themeCss(soft)).toContain(`--sf-link:${soft.palette.foreground}`);
  });
});

describe("stateColors (identidad PRUVA, fase 2)", () => {
  const surfaceOf = (theme: ReturnType<typeof resolveTheme>) => {
    // Igual que --sf-surface: el texto al 5 % sobre el fondo.
    const a = Number.parseInt(theme.palette.foreground.slice(1), 16);
    const b = Number.parseInt(theme.palette.background.slice(1), 16);
    return `#${[16, 8, 0]
      .map((s) =>
        Math.round(((a >> s) & 255) * 0.05 + ((b >> s) & 255) * 0.95)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };

  it("cada estilo sugerido usa los colores fijos, con ≥ 4.5:1 en fondo y superficie", () => {
    for (const preset of THEME_PRESETS) {
      const theme = resolveTheme({ colors: preset.colors });
      const state = stateColors(theme);
      expect(state).toEqual(STATE_COLORS);
      for (const color of Object.values(state)) {
        expect(contrastRatio(color, theme.palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color, surfaceOf(theme))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("con un fondo oscuro cae en el color de texto y siempre llega al CSS", () => {
    const dark = resolveTheme({
      colors: { background: "#101418", foreground: "#f5f5f5", muted: "#c8ccd2" },
    });
    expect(stateColors(dark)).toEqual({
      danger: "#f5f5f5",
      success: "#f5f5f5",
      warning: "#f5f5f5",
    });
    expect(themeCss(dark)).toContain("--sf-danger:#f5f5f5");
    expect(themeCss(resolveTheme({}))).toContain(`--sf-success:${STATE_COLORS.success}`);
  });
});

describe("photoBlend: fotos de producto sin fondo negro", () => {
  const colors = (background: string, foreground: string) =>
    resolveTheme({ colors: { background, foreground, primary: "#1d3fd1", accent: "#d62d20" } });

  it("con fondo claro multiplica: el blanco de la foto se funde con el gris de la tienda", () => {
    expect(photoBlend(colors("#ffffff", "#1a1c22"))).toBe("multiply");
    for (const preset of THEME_PRESETS) {
      expect(photoBlend(resolveTheme({ colors: preset.colors }))).toBe("multiply");
    }
  });

  it("con fondo oscuro o de tono medio no multiplica: la foto se ve tal cual", () => {
    expect(photoBlend(colors("#000000", "#ffffff"))).toBe("normal");
    expect(photoBlend(colors("#1e3a5f", "#ffffff"))).toBe("normal");
    expect(photoBlend(colors("#808080", "#000000"))).toBe("normal");
  });

  it("la variable va en el CSS del tema", () => {
    expect(themeCss(colors("#000000", "#ffffff"))).toContain("--sf-photo-blend:normal");
    expect(themeCss(colors("#ffffff", "#1a1c22"))).toContain("--sf-photo-blend:multiply");
  });
});
