import { contrastRatio } from "@/lib/color/contrast";

/**
 * Paleta de la tienda y sus reglas de contraste (GATE0 §20.2). Espejo exacto de
 * app.theme_default_colors / app.theme_contrast_issues: la base es la autoridad;
 * esto solo da feedback inmediato en el panel. Ver tests/integration/theme-parity.
 */
export const COLOR_KEYS = ["primary", "accent", "background", "foreground", "muted"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type Palette = Record<ColorKey, string>;

export const DEFAULT_COLORS: Palette = {
  primary: "#1d4ed8",
  accent: "#b45309",
  background: "#ffffff",
  foreground: "#111827",
  muted: "#4b5563",
};

export interface ContrastIssue {
  key: ColorKey;
  ratio: number;
  required: number;
}

const RULES: ReadonlyArray<{ key: ColorKey; required: number }> = [
  { key: "foreground", required: 4.5 },
  { key: "muted", required: 4.5 },
  { key: "primary", required: 3 },
  { key: "accent", required: 3 },
];

export function resolvePalette(partial: Partial<Palette> | undefined): Palette {
  return { ...DEFAULT_COLORS, ...partial };
}

/**
 * Comprobaciones que fallan, en el mismo orden que la base. Con botones
 * `outline` el texto del botón es `primary` sobre el fondo: exige 4.5:1 como
 * cualquier texto (F9-DESIGN §13 M5).
 */
export function contrastIssues(
  palette: Palette,
  buttonStyle: "solid" | "outline" = "solid",
): ContrastIssue[] {
  return RULES.flatMap(({ key, required }) => {
    const min = key === "primary" && buttonStyle === "outline" ? 4.5 : required;
    const ratio = contrastRatio(palette[key], palette.background);
    return ratio < min ? [{ key, ratio, required: min }] : [];
  });
}

export type ThemeContrastKey = ColorKey | "announcement";

/**
 * Todas las comprobaciones de contraste de un tema (paleta + barra de anuncio),
 * con las mismas claves y el mismo orden que `app.theme_contrast_issues`.
 */
export function themeContrastIssues(settings: {
  colors?: Partial<Palette>;
  shape?: { button_style?: "solid" | "outline" };
  header?: { announcement?: { background: string; foreground: string } };
}): ThemeContrastKey[] {
  const keys: ThemeContrastKey[] = contrastIssues(
    resolvePalette(settings.colors),
    settings.shape?.button_style ?? "solid",
  ).map((i) => i.key);
  const bar = settings.header?.announcement;
  if (bar && contrastRatio(bar.foreground, bar.background) < 4.5) keys.push("announcement");
  return keys;
}

/** Texto de los botones: blanco o negro, el de mayor contraste con primary (siempre ≥ 4.5:1). */
export function buttonTextColor(primary: string): "#ffffff" | "#000000" {
  return contrastRatio("#ffffff", primary) >= contrastRatio("#000000", primary)
    ? "#ffffff"
    : "#000000";
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Corrección sugerida (ADR-034 §1): el color más parecido al elegido que llega
 * al contraste pedido contra el fondo. Se mezcla poco a poco hacia negro o
 * blanco (el que contrasta con el fondo) y se devuelve el primer paso que
 * cumple, así el tono se conserva lo más posible. Si el color ya cumple, igual.
 */
export function suggestContrastFix(color: string, background: string, required: number): string {
  if (contrastRatio(color, background) >= required) return color;
  const target: [number, number, number] =
    contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
      ? [0, 0, 0]
      : [255, 255, 255];
  const from = hexToRgb(color);
  for (let step = 1; step <= 100; step++) {
    const t = step / 100;
    const mixed = rgbToHex([
      from[0] + (target[0] - from[0]) * t,
      from[1] + (target[1] - from[1]) * t,
      from[2] + (target[2] - from[2]) * t,
    ]);
    if (contrastRatio(mixed, background) >= required) return mixed;
  }
  return rgbToHex(target);
}
