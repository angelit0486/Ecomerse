import type { Palette } from "./palette";
import type { FontKey } from "./schema";

/**
 * Estilos sugeridos de Apariencia (F9-T05): puntos de partida que la tienda
 * aplica a su borrador y luego ajusta. No es código especial de ninguna tienda:
 * cualquier comerciante los ve y elige. «Anaquel» es la identidad de la tienda
 * insignia desde el rediseño A+B (aprobado por la dueña): tienda grande y clara.
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
    key: "anaquel",
    name: "Anaquel",
    description:
      "Blanco de anaquel, azul para comprar y rojo solo para las ofertas; títulos Montserrat. Tienda grande y clara.",
    colors: {
      primary: "#1d3fd1",
      accent: "#d62d20",
      background: "#ffffff",
      foreground: "#1a1c22",
      muted: "#5b616e",
    },
    heading: "montserrat",
    body: "inter",
    radius: "md",
    buttonStyle: "solid",
  },
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
    description: "Blanco, azul marino y rojo para ofertas; tipografía Inter. Sobrio y claro.",
    // Paleta propia (revisión de conversión, B6): el azul por defecto de Tailwind
    // (#1d4ed8) hacía que la tienda se viera a plantilla.
    colors: {
      primary: "#1e3a5f",
      accent: "#b42318",
      background: "#ffffff",
      foreground: "#101828",
      muted: "#475467",
    },
    heading: "inter",
    body: "inter",
    radius: "md",
    buttonStyle: "solid",
  },
  {
    key: "grafito",
    name: "Grafito y oliva",
    description:
      "Grafito sobre blanco cálido, verde oliva profundo para comprar y terracota moderado para ofertas; títulos Space Grotesk. Editorial y sobrio.",
    // Dirección de arte del super prompt (§4): contraste ≥ 4.5:1 en texto, botón y
    // ofertas (presets.test.ts). Sin degradados ni efectos.
    colors: {
      primary: "#3d4a26",
      accent: "#a3471a",
      background: "#faf8f3",
      foreground: "#1d2023",
      muted: "#53595f",
    },
    heading: "space-grotesk",
    body: "inter",
    radius: "sm",
    buttonStyle: "solid",
  },
];
