import { describe, expect, it } from "vitest";

import { DEFAULT_COLORS } from "./palette";
import { resolveTheme, themeCss } from "./resolve-theme";

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
