import { DEFAULT_COLORS, type Palette } from "./palette";
import type { FontKey } from "./schema";

/**
 * Estilos sugeridos de Apariencia (F9-T05): puntos de partida que la tienda
 * aplica a su borrador y luego ajusta. No es código especial de ninguna tienda:
 * cualquier comerciante los ve y elige. «Deportivo» es la identidad de la tienda
 * insignia (F9-DESIGN §15), propia y distinta de GNC, Birdman y B Life.
 */
export interface ThemePreset {
  key: string;
  name: string;
  description: string;
  colors: Palette;
  heading: FontKey;
  body: FontKey;
  radius: "none" | "sm" | "md" | "full";
  buttonStyle: "solid" | "outline";
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    key: "deportivo",
    name: "Deportivo",
    description:
      "Verde profundo y cobre sobre hueso cálido; títulos condensados para precios y objetivos.",
    colors: {
      primary: "#0b5d4b",
      accent: "#b4500c",
      background: "#fbfaf7",
      foreground: "#14181f",
      muted: "#4a5260",
    },
    heading: "barlow-condensed",
    body: "inter",
    radius: "sm",
    buttonStyle: "solid",
  },
  {
    key: "neutral",
    name: "Neutral",
    description: "Blanco, azul y tipografía Inter: el estilo base de la plataforma.",
    colors: DEFAULT_COLORS,
    heading: "inter",
    body: "inter",
    radius: "md",
    buttonStyle: "solid",
  },
];
