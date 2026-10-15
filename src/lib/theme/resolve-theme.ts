import { buttonTextColor, COLOR_KEYS, resolvePalette, type Palette } from "./palette";
import { FONT_KEYS, type FontKey } from "./schema";

/**
 * Tema de la tienda → variables CSS del storefront (GATE0 §20.3, `resolveTheme`).
 * Sin fila o con claves ausentes se usan los defaults del tema. Todo valor pasa
 * por una lista blanca (hex de 6 dígitos, radios, estilos y claves de fuente
 * conocidos) aunque la base ya lo valide: el resultado va dentro de una etiqueta
 * <style> (sin CSS del comerciante, §44.13).
 */
export interface ResolvedTheme {
  palette: Palette;
  buttonText: "#ffffff" | "#000000";
  radius: string;
  buttonStyle: "solid" | "outline";
  fonts: { heading: FontKey; body: FontKey };
  logoPosition: "left" | "center";
  announcement: {
    text: string;
    link: string | null;
    background: string;
    foreground: string;
  } | null;
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const RADIUS: Record<string, string> = { none: "0px", sm: "4px", md: "8px", full: "9999px" };
const FONT_SET = new Set<string>(FONT_KEYS);
export const DEFAULT_FONT: FontKey = "inter";

type Raw = {
  colors?: Record<string, unknown>;
  shape?: { radius?: unknown; button_style?: unknown };
  typography?: { heading?: unknown; body?: unknown };
  header?: {
    logo_position?: unknown;
    announcement?: { text?: unknown; link?: unknown; background?: unknown; foreground?: unknown };
  };
};

function fontKey(value: unknown): FontKey {
  return typeof value === "string" && FONT_SET.has(value) ? (value as FontKey) : DEFAULT_FONT;
}

function hex(value: unknown): string | null {
  return typeof value === "string" && HEX_RE.test(value) ? value : null;
}

export function resolveTheme(settings: unknown): ResolvedTheme {
  const s = (settings && typeof settings === "object" ? settings : {}) as Raw;
  const colors: Partial<Palette> = {};
  for (const key of COLOR_KEYS) {
    const value = hex(s.colors?.[key]);
    if (value) colors[key] = value;
  }
  const palette = resolvePalette(colors);
  const radius = typeof s.shape?.radius === "string" ? RADIUS[s.shape.radius] : undefined;
  const bar = s.header?.announcement;
  const barBg = hex(bar?.background);
  const barFg = hex(bar?.foreground);
  return {
    palette,
    buttonText: buttonTextColor(palette.primary),
    radius: radius ?? RADIUS.md!,
    buttonStyle: s.shape?.button_style === "outline" ? "outline" : "solid",
    fonts: { heading: fontKey(s.typography?.heading), body: fontKey(s.typography?.body) },
    logoPosition: s.header?.logo_position === "center" ? "center" : "left",
    announcement:
      bar && typeof bar.text === "string" && bar.text && barBg && barFg
        ? {
            text: bar.text,
            link: typeof bar.link === "string" ? bar.link : null,
            background: barBg,
            foreground: barFg,
          }
        : null,
  };
}

/** Declaraciones CSS de las variables del storefront (solo valores de la lista blanca). */
export function themeCss(theme: ResolvedTheme): string {
  const p = theme.palette;
  const outline = theme.buttonStyle === "outline";
  const declarations = [
    `--sf-primary:${p.primary}`,
    `--sf-accent:${p.accent}`,
    `--sf-bg:${p.background}`,
    `--sf-fg:${p.foreground}`,
    `--sf-muted:${p.muted}`,
    `--sf-on-primary:${theme.buttonText}`,
    `--sf-radius:${theme.radius}`,
    // Botón principal: relleno o contorno (§20.2). El contorno exige 4.5:1 (§13 M5).
    `--sf-btn-bg:${outline ? p.background : p.primary}`,
    `--sf-btn-fg:${outline ? p.primary : theme.buttonText}`,
    `--sf-btn-border:${p.primary}`,
    `--sf-font-heading:var(--font-${theme.fonts.heading})`,
    `--sf-font-body:var(--font-${theme.fonts.body})`,
  ];
  if (theme.announcement) {
    declarations.push(
      `--sf-announce-bg:${theme.announcement.background}`,
      `--sf-announce-fg:${theme.announcement.foreground}`,
    );
  }
  return declarations.join(";");
}
