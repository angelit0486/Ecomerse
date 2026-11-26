import localFont from "next/font/local";

import type { FontKey } from "@/lib/theme/schema";

/**
 * Tipografía curada de la tienda (D-F9-01, F9-DESIGN §2.3 y §13 H4). `next/font`
 * exige declaraciones estáticas: las 10 se declaran aquí, autoalojadas (CSP
 * `font-src 'self'`), solo el subconjunto latin (á é í ó ú ñ ü ¿ ¡), sin
 * precarga y con fallback métrico ajustado. El navegador descarga únicamente las
 * fuentes que el CSS de la tienda usa: las dos que eligió. Las rutas van
 * literales (next/font no acepta expresiones).
 *
 * `display: "optional"` (26 nov 2026): con `swap`, la fuente llegaba después del
 * primer pintado y el texto se reacomodaba (CLS 0.287 en la portada Nocturno en
 * CI). El respaldo ajustado usa `local(Arial)`, que no existe en Android ni en
 * algunos Linux: sin él, el respaldo es más ancho y títulos y avisos cambian de
 * renglones al llegar la fuente. Con `optional`, si la fuente no está lista en
 * ~100 ms esa página se queda con el respaldo (sin saltos) y la siguiente ya usa
 * la fuente de la caché.
 */
const inter = localFont({
  src: "../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "optional",
  preload: false,
});
const dmSans = localFont({
  src: "../../../../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "optional",
  preload: false,
});
const manrope = localFont({
  src: "../../../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "optional",
  preload: false,
});
const workSans = localFont({
  src: "../../../../../node_modules/@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-work-sans",
  display: "optional",
  preload: false,
});
const lora = localFont({
  src: "../../../../../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-lora",
  display: "optional",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const oswald = localFont({
  src: "../../../../../node_modules/@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2",
  weight: "200 700",
  variable: "--font-oswald",
  display: "optional",
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
  display: "optional",
  preload: false,
});
const montserrat = localFont({
  src: "../../../../../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "optional",
  preload: false,
});
const playfairDisplay = localFont({
  src: "../../../../../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2",
  weight: "400 900",
  variable: "--font-playfair-display",
  display: "optional",
  preload: false,
  adjustFontFallback: "Times New Roman",
});
const spaceGrotesk = localFont({
  src: "../../../../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "optional",
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
