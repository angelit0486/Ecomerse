import { buttonTextColor, COLOR_KEYS, resolvePalette, type Palette } from "./palette";

/**
 * Tema de la tienda → variables CSS del storefront (GATE0 §20, `resolveTheme`).
 * Sin fila o con claves ausentes se usan los defaults. Todo valor pasa por una
 * lista blanca (hex de 6 dígitos, radios y estilos conocidos) aunque la base ya
 * lo valide: el resultado va dentro de una etiqueta <style> (sin CSS del
 * comerciante, §44.13).
 */
export interface ResolvedTheme {
  palette: Palette;
  buttonText: "#ffffff" | "#000000";
  radius: string;
  buttonStyle: "solid" | "outline";
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const RADIUS: Record<string, string> = { none: "0px", sm: "4px", md: "8px", full: "9999px" };

export function resolveTheme(settings: unknown): ResolvedTheme {
  const s = (settings && typeof settings === "object" ? settings : {}) as {
    colors?: Record<string, unknown>;
    shape?: { radius?: unknown; button_style?: unknown };
  };
  const colors: Partial<Palette> = {};
  for (const key of COLOR_KEYS) {
    const value = s.colors?.[key];
    if (typeof value === "string" && HEX_RE.test(value)) colors[key] = value;
  }
  const palette = resolvePalette(colors);
  const radius = typeof s.shape?.radius === "string" ? RADIUS[s.shape.radius] : undefined;
  return {
    palette,
    buttonText: buttonTextColor(palette.primary),
    radius: radius ?? RADIUS.md!,
    buttonStyle: s.shape?.button_style === "outline" ? "outline" : "solid",
  };
}

/** Declaraciones CSS de las variables del storefront (solo valores de la lista blanca). */
export function themeCss(theme: ResolvedTheme): string {
  const p = theme.palette;
  return [
    `--sf-primary:${p.primary}`,
    `--sf-accent:${p.accent}`,
    `--sf-bg:${p.background}`,
    `--sf-fg:${p.foreground}`,
    `--sf-muted:${p.muted}`,
    `--sf-on-primary:${theme.buttonText}`,
    `--sf-radius:${theme.radius}`,
  ].join(";");
}
