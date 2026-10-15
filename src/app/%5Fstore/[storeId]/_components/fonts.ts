import localFont from "next/font/local";

import type { FontKey } from "@/lib/theme/schema";

/**
 * Tipografía curada de la tienda (D-F9-01, F9-DESIGN §2.3 y §13 H4). `next/font`
 * exige declaraciones estáticas: las 10 se declaran aquí, autoalojadas (CSP
 * `font-src 'self'`), solo el subconjunto latin (á é í ó ú ñ ü ¿ ¡), sin
 * precarga y con fallback métrico ajustado. El navegador descarga únicamente las
 * fuentes que el CSS de la tienda usa: las dos que eligió. Las rutas van
 * literales (next/font no acepta expresiones).
 */
const inter = localFont({
  src: "../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
  preload: false,
});
const dmSans = localFont({
  src: "../../../../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "swap",
  preload: false,
});
const manrope = localFont({
  src: "../../../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
  preload: false,
});
const workSans = localFont({
  src: "../../../../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-work-sans",
  display: "swap",
  preload: false,
});
const lora = localFont({
  src: "../../../../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-lora",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const oswald = localFont({
  src: "../../../../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2",
  weight: "200 700",
  variable: "--font-oswald",
  display: "swap",
  preload: false,
});
const barlowCondensed = localFont({
  src: [
    {
      path: "../../../../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../../../../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2",
      weight: "700",
    },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
  preload: false,
});
const montserrat = localFont({
  src: "../../../../../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "swap",
  preload: false,
});
const playfairDisplay = localFont({
  src: "../../../../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2",
  weight: "400 900",
  variable: "--font-playfair-display",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const spaceGrotesk = localFont({
  src: "../../../../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "swap",
  preload: false,
});

const FONTS: Record<FontKey, { variable: string }> = {
  inter,
  "dm-sans": dmSans,
  manrope,
  "work-sans": workSans,
  lora,
  oswald,
  "barlow-condensed": barlowCondensed,
  montserrat,
  "playfair-display": playfairDisplay,
  "space-grotesk": spaceGrotesk,
};

/**
 * Clases que definen las variables `--font-*` (sin aplicar ninguna fuente).
 * Solo las de las fuentes elegidas: así el CSS de la página no declara las otras.
 */
export function fontVariableClasses(keys: readonly FontKey[]): string {
  return [...new Set(keys)].map((k) => FONTS[k].variable).join(" ");
}
