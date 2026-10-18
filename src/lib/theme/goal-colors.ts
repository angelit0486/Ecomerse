/**
 * Colores de los bloques «¿Qué quieres lograr?» (rediseño A+B, bloques de la
 * propuesta B). Fijos y no editables: cada par fondo/texto llega a 4.5:1
 * (goal-colors.test.ts), así que el texto pequeño («12 productos») también se lee.
 * Los objetivos conocidos tienen su color; los demás toman, en orden, los que
 * queden libres.
 */
export interface GoalColor {
  bg: string;
  fg: string;
}

const ORANGE: GoalColor = { bg: "#cf4410", fg: "#ffffff" };
const YELLOW: GoalColor = { bg: "#f5c400", fg: "#2b2300" };
const VIOLET: GoalColor = { bg: "#7c3aed", fg: "#ffffff" };
const GREEN: GoalColor = { bg: "#108556", fg: "#ffffff" };
const TEAL: GoalColor = { bg: "#0e7490", fg: "#ffffff" };
const PINK: GoalColor = { bg: "#be185d", fg: "#ffffff" };
const SLATE: GoalColor = { bg: "#334155", fg: "#ffffff" };

export const GOAL_PALETTE: readonly GoalColor[] = [
  ORANGE,
  YELLOW,
  VIOLET,
  GREEN,
  TEAL,
  PINK,
  SLATE,
];

/** Claves de objetivo (slug de la etiqueta) con un color propio. */
const BY_KEY: Record<string, GoalColor> = {
  fuerza: ORANGE,
  "masa-muscular": ORANGE,
  energia: YELLOW,
  rendimiento: YELLOW,
  recuperacion: VIOLET,
  descanso: VIOLET,
  bienestar: GREEN,
  salud: GREEN,
  hidratacion: TEAL,
  "control-de-peso": PINK,
};

/** Un color por objetivo, en el mismo orden; sin repetir mientras alcance la paleta. */
export function goalColors(keys: readonly string[]): GoalColor[] {
  const taken = new Set<GoalColor>();
  const result: (GoalColor | null)[] = keys.map((key) => {
    const known = BY_KEY[key];
    if (!known || taken.has(known)) return null;
    taken.add(known);
    return known;
  });
  let next = 0;
  return result.map((color) => {
    if (color) return color;
    const free = GOAL_PALETTE.find((c) => !taken.has(c));
    if (free) {
      taken.add(free);
      return free;
    }
    return GOAL_PALETTE[next++ % GOAL_PALETTE.length]!;
  });
}
