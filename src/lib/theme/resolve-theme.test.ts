import { describe, expect, it } from "vitest";

import { DEFAULT_COLORS } from "./palette";
import { contrastRatio } from "@/lib/color/contrast";

import { resolveTheme, saleColors, themeCss } from "./resolve-theme";

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
      shape: { radius: "1px;}*{x:y" },
    });
    expect(theme.palette).toEqual(DEFAULT_COLORS);
    const css = themeCss(theme);
    expect(css).not.toMatch(/[{}<>]|url\(|;;/);
    expect(
      css
        .split(";")
        .every((d) => /^--sf-[a-z-]+:(#[0-9a-f]{6}|\d+px|var\(--font-[a-z-]+\))$/.test(d)),
    ).toBe(true);
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
