import { contrastRatio } from "@/lib/color/contrast";

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

/**
 * Colores de oferta (revisión de conversión, M8; §15 reserva el acento para
 * ofertas y ahorro): el acento solo garantiza 3:1 contra el fondo, así que se
 * usa únicamente donde su texto llega a 4.5:1; si no, el estilo del botón y el
 * color del texto.
 */
export function saleColors(theme: ResolvedTheme): { bg: string; fg: string; text: string } {
  const p = theme.palette;
  const onAccent = buttonTextColor(p.accent);
  const badge =
    contrastRatio(onAccent, p.accent) >= 4.5
      ? { bg: p.accent, fg: onAccent }
      : theme.buttonStyle === "outline"
        ? { bg: p.background, fg: p.primary }
        : { bg: p.primary, fg: theme.buttonText };
  const text = contrastRatio(p.accent, p.background) >= 4.5 ? p.accent : p.foreground;
  return { ...badge, text };
}

/** Mezcla `hex` con negro (factor 0–1): oscurecer solo sube el contraste con el blanco. */
function darken(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `#${[n >> 16, (n >> 8) & 255, n & 255]
    .map((c) =>
      Math.round(c * (1 - factor))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Pie de la tienda (rediseño A+B): el primario oscurecido con texto blanco cuando
 * el primario ya lleva texto blanco (≥ 4.5:1, y oscurecer solo lo sube); si el
 * primario es claro, el par texto/fondo del tema invertido, que ya se valida.
 */
export function footerColors(theme: ResolvedTheme): { bg: string; fg: string } {
  const p = theme.palette;
  return theme.buttonText === "#ffffff"
    ? { bg: darken(p.primary, 0.35), fg: "#ffffff" }
    : { bg: p.foreground, fg: p.background };
}

/**
 * Color de enlaces y botones de contorno sobre el fondo (rediseño A+B): el
 * primario solo si llega a 4.5:1 como texto (con botones rellenos el tema solo le
 * exige 3:1); si no, el color de texto.
 */
export function linkColor(theme: ResolvedTheme): string {
  const p = theme.palette;
  return contrastRatio(p.primary, p.background) >= 4.5 ? p.primary : p.foreground;
}

/** Declaraciones CSS de las variables del storefront (solo valores de la lista blanca). */
export function themeCss(theme: ResolvedTheme): string {
  const p = theme.palette;
  const outline = theme.buttonStyle === "outline";
  const sale = saleColors(theme);
  const footer = footerColors(theme);
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
    `--sf-sale-bg:${sale.bg}`,
    `--sf-sale-fg:${sale.fg}`,
    `--sf-sale-text:${sale.text}`,
    `--sf-footer-bg:${footer.bg}`,
    `--sf-footer-fg:${footer.fg}`,
    `--sf-link:${linkColor(theme)}`,
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
