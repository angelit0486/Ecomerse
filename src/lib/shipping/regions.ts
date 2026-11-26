import { MX_STATES } from "@/lib/checkout/mx-states";

type MxState = (typeof MX_STATES)[number];

/**
 * Regiones de una zona de envío de México (panel, 2026-11-26). El cálculo del
 * carrito compara el estado del comprador con las regiones de la zona letra por
 * letra (sin distinguir mayúsculas): «Jalsico» o «Nuevo Leon» hacían que la zona
 * nunca aplicara, sin ningún aviso. Aquí cada región escrita se convierte al
 * nombre oficial que usa el checkout, o se rechaza diciendo cuál.
 */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.\s]+/g, " ")
    .trim();

// Nombres y abreviaturas comunes que la gente escribe.
const ALIASES: Record<string, MxState> = {
  cdmx: "Ciudad de México",
  df: "Ciudad de México",
  "distrito federal": "Ciudad de México",
  edomex: "Estado de México",
  "edo mex": "Estado de México",
  "edo de mexico": "Estado de México",
  mexico: "Estado de México",
  nl: "Nuevo León",
  bc: "Baja California",
  bcs: "Baja California Sur",
  qroo: "Quintana Roo",
  "q roo": "Quintana Roo",
  slp: "San Luis Potosí",
  "coahuila de zaragoza": "Coahuila",
  "michoacan de ocampo": "Michoacán",
  "veracruz de ignacio de la llave": "Veracruz",
};

const BY_FOLD = new Map<string, MxState>(MX_STATES.map((s) => [fold(s), s] as const));

export function mxStateName(input: string): MxState | null {
  const key = fold(input);
  return BY_FOLD.get(key) ?? ALIASES[key] ?? null;
}

/** Regiones escritas o elegidas → nombres oficiales, sin repetir; las que no son estados, aparte. */
export function normalizeMxRegions(list: readonly string[]): {
  regions: string[];
  unknown: string[];
} {
  const regions: string[] = [];
  const unknown: string[] = [];
  for (const raw of list) {
    const value = raw.trim();
    if (!value) continue;
    const name = mxStateName(value);
    if (name === null) unknown.push(value);
    else if (!regions.includes(name)) regions.push(name);
  }
  return { regions, unknown };
}

/** La zona es solo de México: sus regiones se eligen de la lista de estados. */
export const isMexicoOnly = (countries: readonly string[]) =>
  countries.length === 1 && countries[0]!.toUpperCase() === "MX";
