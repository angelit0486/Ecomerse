/**
 * Los 32 estados de México con su nombre oficial (con acentos). El checkout los
 * ofrece en una lista para que el estado del comprador coincida letra por letra
 * con las regiones de las zonas de envío (`app.calculate_cart` compara el texto).
 */
export const MX_STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
] as const;

type MxState = (typeof MX_STATES)[number];

// Rangos de los dos primeros dígitos del código postal por estado (asignación de SEPOMEX).
const CP_RANGES: readonly [number, number, MxState][] = [
  [1, 16, "Ciudad de México"],
  [20, 20, "Aguascalientes"],
  [21, 22, "Baja California"],
  [23, 23, "Baja California Sur"],
  [24, 24, "Campeche"],
  [25, 27, "Coahuila"],
  [28, 28, "Colima"],
  [29, 30, "Chiapas"],
  [31, 33, "Chihuahua"],
  [34, 35, "Durango"],
  [36, 38, "Guanajuato"],
  [39, 41, "Guerrero"],
  [42, 43, "Hidalgo"],
  [44, 49, "Jalisco"],
  [50, 57, "Estado de México"],
  [58, 61, "Michoacán"],
  [62, 62, "Morelos"],
  [63, 63, "Nayarit"],
  [64, 67, "Nuevo León"],
  [68, 71, "Oaxaca"],
  [72, 75, "Puebla"],
  [76, 76, "Querétaro"],
  [77, 77, "Quintana Roo"],
  [78, 79, "San Luis Potosí"],
  [80, 82, "Sinaloa"],
  [83, 85, "Sonora"],
  [86, 86, "Tabasco"],
  [87, 89, "Tamaulipas"],
  [90, 90, "Tlaxcala"],
  [91, 96, "Veracruz"],
  [97, 97, "Yucatán"],
  [98, 99, "Zacatecas"],
];

/** Estado al que pertenece un código postal mexicano de 5 dígitos (o null si no aplica). */
export function stateForPostalCode(postalCode: string): MxState | null {
  const cp = postalCode.trim();
  if (!/^\d{5}$/.test(cp)) return null;
  const prefix = Number(cp.slice(0, 2));
  return CP_RANGES.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null;
}
