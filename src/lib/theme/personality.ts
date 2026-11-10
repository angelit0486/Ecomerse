import { PERSONALITY_OPTIONS, type Personality, type PersonalityKey } from "./constants";

/**
 * Personalidad del diseño (tema v5, ADR-063 fase B-1) → atributos `data-*` de la
 * raíz de la tienda. Las reglas CSS son fijas (`PERSONALITY_CSS`) y solo miran
 * esos atributos: ningún valor de la tienda llega al CSS (regla 13). Sin
 * personalidad no se agrega ningún atributo y la tienda se ve como antes.
 */
function pick<K extends PersonalityKey>(
  raw: Record<string, unknown>,
  key: K,
): (typeof PERSONALITY_OPTIONS)[K][number] | undefined {
  const value = raw[key];
  return typeof value === "string" &&
    (PERSONALITY_OPTIONS[key] as readonly string[]).includes(value)
    ? (value as (typeof PERSONALITY_OPTIONS)[K][number])
    : undefined;
}

/** Solo los valores de la lista blanca; lo demás se ignora. */
export function readPersonality(value: unknown): Personality {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: Personality = {};
  for (const key of Object.keys(PERSONALITY_OPTIONS) as PersonalityKey[]) {
    const v = pick(raw, key);
    if (v !== undefined) Object.assign(out, { [key]: v });
  }
  return out;
}

export function personalityAttributes(
  value: unknown,
  { cardColors }: { cardColors: boolean },
): Record<`data-${string}`, string> {
  const p = readPersonality(value);
  const a: Record<`data-${string}`, string> = {};
  if (p.card_style === "flat" || p.card_style === "raised") a["data-card"] = p.card_style;
  // Con fondo propio de tarjeta, «plana» conserva el margen interior: el texto no
  // toca el borde de su color.
  if (p.card_style === "flat" && cardColors) a["data-card-bg"] = "";
  if (p.image_ratio === "4:5" || p.image_ratio === "3:4") a["data-ratio"] = p.image_ratio;
  if (p.image_fit === "cover") a["data-fit"] = "cover";
  if (p.card_hover === "lift" || p.card_hover === "none") a["data-hover"] = p.card_hover;
  if (p.card_align === "center") a["data-align"] = "center";
  if (p.heading_case === "uppercase") a["data-hcase"] = "upper";
  if (p.heading_tracking === "tight" || p.heading_tracking === "wide")
    a["data-htrack"] = p.heading_tracking;
  if (p.heading_weight) a["data-hweight"] = p.heading_weight;
  if (p.type_scale === "compact" || p.type_scale === "large") a["data-scale"] = p.type_scale;
  if (p.motion === "subtle") a["data-motion"] = "subtle";
  return a;
}

/**
 * Títulos de la tienda que llevan la fuente de títulos: h1 y los de 20 px para
 * arriba (el layout los usa para la fuente; aquí para mayúsculas, espaciado y peso).
 */
export const DISPLAY_HEADINGS =
  ":is(h1,:is(h2,h3,h4):is([class*=text-xl],[class*=text-2xl],[class*=text-3xl],[class*=text-4xl],[class*=text-5xl])):not(.sf-text-font)";
const HEADINGS = DISPLAY_HEADINGS;

/** Tamaños de título (rem): xl, 2xl, 3xl, 4xl y 5xl de Tailwind en cada escala. */
const SCALE: Record<"compact" | "large", readonly string[]> = {
  compact: ["1.125rem", "1.3125rem", "1.625rem", "1.875rem", "2.5rem"],
  large: ["1.375rem", "1.75rem", "2.25rem", "2.75rem", "3.5rem"],
};
const SIZE_VARS = ["--text-xl", "--text-2xl", "--text-3xl", "--text-4xl", "--text-5xl"];

function scaleRule(scale: "compact" | "large"): string {
  const vars = SIZE_VARS.map((v, i) => `${v}:${SCALE[scale][i]}`).join(";");
  return `.sf-root[data-scale='${scale}'] :is(h1,h2,h3,h4){${vars}}`;
}

/** Bloques de la portada que se mueven: todos los que no son <style>, menos el primero. */
export const MOTION_TARGETS = ".sf-root[data-motion='subtle'] .sf-home>:not(style)~:not(style)";

const RAISED_SHADOW = "0 2px 4px rgb(0 0 0/.06),0 10px 24px rgb(0 0 0/.1)";
const LIFT_SHADOW = "0 4px 8px rgb(0 0 0/.08),0 16px 32px rgb(0 0 0/.14)";

/**
 * Reglas fijas de la personalidad. Van sin capa (después de Tailwind), así que
 * ganan a las utilidades de la tarjeta sin `!important`. El movimiento solo con
 * «sin preferencia de reducir movimiento» y donde el navegador anima con el
 * desplazamiento; si no, la portada queda quieta como hoy.
 */
export const PERSONALITY_CSS = [
  // Tarjeta de producto.
  ".sf-root[data-card='flat'] .sf-card{border-color:transparent;box-shadow:none}",
  ".sf-root[data-card='flat']:not([data-card-bg]) .sf-card{padding:0}",
  `.sf-root[data-card='raised'] .sf-card{border-color:transparent;box-shadow:${RAISED_SHADOW}}`,
  ".sf-root[data-ratio='4:5'] .sf-card-media{aspect-ratio:4/5}",
  ".sf-root[data-ratio='3:4'] .sf-card-media{aspect-ratio:3/4}",
  ".sf-root[data-fit='cover'] .sf-card-img{object-fit:cover;padding:0;mix-blend-mode:normal}",
  ".sf-root:is([data-hover='none'],[data-hover='lift']) .sf-card-img{scale:none}",
  "@media (prefers-reduced-motion:no-preference){" +
    ".sf-root[data-hover='lift'] .sf-card{transition:transform .2s ease,box-shadow .2s ease}" +
    `.sf-root[data-hover='lift'] .sf-card:hover{transform:translateY(-4px);box-shadow:${LIFT_SHADOW}}}`,
  ".sf-root[data-align='center'] .sf-card{text-align:center}",
  ".sf-root[data-align='center'] .sf-card-row{justify-content:center}",
  // Títulos.
  `.sf-root[data-hcase='upper'] ${HEADINGS}{text-transform:uppercase}`,
  `.sf-root[data-htrack='tight'] ${HEADINGS}{letter-spacing:-.02em}`,
  `.sf-root[data-htrack='wide'] ${HEADINGS}{letter-spacing:.08em}`,
  `.sf-root[data-hweight='regular'] ${HEADINGS}{font-weight:400}`,
  `.sf-root[data-hweight='semibold'] ${HEADINGS}{font-weight:600}`,
  `.sf-root[data-hweight='bold'] ${HEADINGS}{font-weight:700}`,
  scaleRule("compact"),
  scaleRule("large"),
  // Movimiento sutil: cada bloque de la portada (menos el primero, que puede ir
  // después de etiquetas <style>) sube un poco al entrar.
  "@keyframes sf-rise{from{transform:translateY(28px)}to{transform:none}}",
  "@media (prefers-reduced-motion:no-preference){@supports (animation-timeline:view()){" +
    `${MOTION_TARGETS}{animation:sf-rise linear both;` +
    "animation-timeline:view();animation-range:entry 0% entry 35%}}}",
].join("");
