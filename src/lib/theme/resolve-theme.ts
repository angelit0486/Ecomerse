import { contrastRatio, relativeLuminance } from "@/lib/color/contrast";

import { buttonTextColor, COLOR_KEYS, resolvePalette, type Palette } from "./palette";
import { isValidInstant } from "./constants";
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
  /** Tema v2 (ADR-034): sombra de tarjetas y espacio entre bloques. */
  shadow: "none" | "soft" | "strong";
  density: "compact" | "comfortable" | "spacious";
  announcement: {
    text: string;
    link: string | null;
    background: string;
    foreground: string;
    /** Vigencia (ISO con zona); fuera de ella la barra no se muestra. */
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}

const SHADOW: Record<ResolvedTheme["shadow"], string> = {
  none: "none",
  soft: "0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.06)",
  strong: "0 2px 4px rgb(0 0 0 / 0.08), 0 12px 28px rgb(0 0 0 / 0.14)",
};
/** Espacio entre bloques de la portada (móvil, escritorio). */
const DENSITY: Record<ResolvedTheme["density"], [string, string]> = {
  compact: ["2rem", "2.5rem"],
  comfortable: ["3rem", "4rem"],
  spacious: ["4rem", "5.5rem"],
};

/** ¿La barra de anuncio está vigente en este momento? */
export function announcementActive(
  announcement: ResolvedTheme["announcement"],
  now: Date = new Date(),
): boolean {
  if (!announcement) return false;
  const t = now.getTime();
  if (announcement.startsAt && Date.parse(announcement.startsAt) > t) return false;
  if (announcement.endsAt && Date.parse(announcement.endsAt) <= t) return false;
  return true;
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const RADIUS: Record<string, string> = { none: "0px", sm: "4px", md: "8px", full: "9999px" };
const FONT_SET = new Set<string>(FONT_KEYS);
export const DEFAULT_FONT: FontKey = "inter";

type Raw = {
  colors?: Record<string, unknown>;
  shape?: { radius?: unknown; button_style?: unknown; shadow?: unknown; density?: unknown };
  typography?: { heading?: unknown; body?: unknown };
  header?: {
    logo_position?: unknown;
    announcement?: {
      text?: unknown;
      link?: unknown;
      background?: unknown;
      foreground?: unknown;
      starts_at?: unknown;
      ends_at?: unknown;
      hidden?: unknown;
    };
  };
};

function instant(value: unknown): string | null {
  return typeof value === "string" && isValidInstant(value) ? value : null;
}

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
    shadow: s.shape?.shadow === "soft" || s.shape?.shadow === "strong" ? s.shape.shadow : "none",
    density:
      s.shape?.density === "compact" || s.shape?.density === "spacious"
        ? s.shape.density
        : "comfortable",
    // Tema v3: «hidden» la apaga sin perder el texto.
    announcement:
      bar && typeof bar.text === "string" && bar.text && barBg && barFg && bar.hidden !== true
        ? {
            text: bar.text,
            link: typeof bar.link === "string" ? bar.link : null,
            background: barBg,
            foreground: barFg,
            startsAt: instant(bar?.starts_at),
            endsAt: instant(bar?.ends_at),
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
  // Acento de tono medio (decisión del propietario 2026-10-19, azul grisáceo de
  // PRUVA): no lleva texto blanco y tampoco es un color claro de insignia (como un
  // ámbar). Con texto negro la oferta perdía jerarquía: toma el botón relleno
  // (azul marino con blanco en PRUVA) y su texto, el color de enlace.
  const midTone =
    onAccent === "#000000" &&
    theme.buttonText === "#ffffff" &&
    theme.buttonStyle === "solid" &&
    contrastRatio(p.accent, p.background) >= 3;
  const badge = midTone
    ? { bg: p.primary, fg: theme.buttonText }
    : contrastRatio(onAccent, p.accent) >= 4.5
      ? { bg: p.accent, fg: onAccent }
      : theme.buttonStyle === "outline"
        ? { bg: p.background, fg: p.primary }
        : { bg: p.primary, fg: theme.buttonText };
  const text =
    contrastRatio(p.accent, p.background) >= 4.5
      ? p.accent
      : midTone
        ? linkColor(theme)
        : p.foreground;
  return { ...badge, text };
}

/**
 * Colores de estado del storefront (identidad PRUVA, fase 2): error, éxito y
 * aviso fijos, elegidos con ≥ 4.5:1 sobre el fondo y la superficie gris de todos
 * los estilos sugeridos. Si un fondo propio de la tienda no llega a 4.5:1 con
 * alguno (p. ej. un fondo oscuro), ese estado usa el color de texto: el mensaje
 * se sigue leyendo y su sentido lo da el texto, nunca solo el color.
 */
export const STATE_COLORS = { danger: "#b42318", success: "#16703a", warning: "#8a5a00" } as const;

export function stateColors(theme: ResolvedTheme): Record<keyof typeof STATE_COLORS, string> {
  const p = theme.palette;
  // La superficie (`--sf-surface`) es el texto al 5 % sobre el fondo.
  const surface = mix(p.foreground, p.background, 0.05);
  const pick = (color: string) =>
    Math.min(contrastRatio(color, p.background), contrastRatio(color, surface)) >= 4.5
      ? color
      : p.foreground;
  return {
    danger: pick(STATE_COLORS.danger),
    success: pick(STATE_COLORS.success),
    warning: pick(STATE_COLORS.warning),
  };
}

/**
 * Mezcla de las fotos de producto con su marco. Sobre una superficie clara,
 * `multiply` funde el fondo blanco de la foto con el gris de la tienda; sobre una
 * oscura lo volvería negro (y oscurecería el producto), así que la foto va tal cual.
 */
export function photoBlend(theme: ResolvedTheme): "multiply" | "normal" {
  const surface = mix(theme.palette.foreground, theme.palette.background, 0.05);
  return relativeLuminance(surface) >= 0.6 ? "multiply" : "normal";
}

/** `a` al `share` (0–1) sobre `b`, como `color-mix(in srgb, a share, b)`. */
function mix(a: string, b: string, share: number): string {
  const ca = Number.parseInt(a.slice(1), 16);
  const cb = Number.parseInt(b.slice(1), 16);
  return `#${[16, 8, 0]
    .map((shift) =>
      Math.round(((ca >> shift) & 255) * share + ((cb >> shift) & 255) * (1 - share))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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
  const state = stateColors(theme);
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
    `--sf-photo-blend:${photoBlend(theme)}`,
    `--sf-danger:${state.danger}`,
    `--sf-success:${state.success}`,
    `--sf-warning:${state.warning}`,
    `--sf-font-heading:var(--font-${theme.fonts.heading})`,
    `--sf-font-body:var(--font-${theme.fonts.body})`,
    `--sf-shadow-card:${SHADOW[theme.shadow]}`,
    `--sf-section-gap:${DENSITY[theme.density][0]}`,
    `--sf-section-gap-lg:${DENSITY[theme.density][1]}`,
  ];
  if (theme.announcement) {
    declarations.push(
      `--sf-announce-bg:${theme.announcement.background}`,
      `--sf-announce-fg:${theme.announcement.foreground}`,
    );
  }
  return declarations.join(";");
}
