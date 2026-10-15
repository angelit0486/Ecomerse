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
