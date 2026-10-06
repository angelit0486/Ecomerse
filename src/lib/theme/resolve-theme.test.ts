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
    expect(css.split(";").every((d) => /^--sf-[a-z-]+:(#[0-9a-f]{6}|\d+px)$/.test(d))).toBe(true);
  });
});
