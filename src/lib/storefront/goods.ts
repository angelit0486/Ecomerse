/**
 * «Anaquel ilustrado» (misión vendible F2): objeto del giro que representa una
 * categoría o un producto sin foto, elegido por palabras clave de su nombre.
 * Las reglas más específicas van primero («collar» antes que «accesorio»).
 * Los dibujos viven en el storefront (`goods-art.tsx`); aquí solo la elección.
 */
export const GOODS = [
  "shirt",
  "pants",
  "hoodie",
  "cap",
  "dress",
  "shoe",
  "bag",
  "tub",
  "jar",
  "capsule",
  "shaker",
  "dropper",
  "lipstick",
  "comb",
  "bottle",
  "spray",
  "snack",
  "mug",
  "lamp",
  "plant",
  "candle",
  "cushion",
  "bowl",
  "ball",
  "collar",
  "petbed",
  "tag",
  "box",
] as const;

export type Good = (typeof GOODS)[number];

const RULES: ReadonlyArray<readonly [Good, readonly string[]]> = [
  ["collar", ["collar", "correa", "pechera"]],
  ["petbed", ["cama", "descanso", "transportadora"]],
  ["bowl", ["croqueta", "alimento", "comedero", "premio"]],
  ["ball", ["juguete", "pelota", "mordedera"]],
  // Antes que la piel (cuidado facial): «botas de piel». Y botanas antes que botas.
  ["snack", ["botana", "papas", "snack", "galleta", "dulce"]],
  ["shoe", ["tenis", "zapato", "calzado", "sandalia", "bota"]],
  ["shaker", ["preentreno", "pre-entreno", "pre entreno", "shaker", "energia"]],
  ["tub", ["proteina", "whey", "ganador", "gainer"]],
  ["capsule", ["vitamina", "capsula", "omega", "multivitam", "suplemento", "tableta"]],
  ["lipstick", ["labial", "maquillaje", "rubor", "base de"]],
  ["dropper", ["piel", "serum", "suero facial", "facial", "crema", "hidratante"]],
  ["comb", ["cabello", "shampoo", "champu", "acondicionador", "peine"]],
  ["hoodie", ["sudadera", "chamarra", "sueter", "abrigo"]],
  ["pants", ["pantalon", "jeans", "mezclilla", "short", "falda short"]],
  ["dress", ["vestido", "falda"]],
  ["cap", ["gorra", "sombrero"]],
  ["shirt", ["playera", "camisa", "blusa", "polo"]],
  ["candle", ["vela", "aroma", "difusor"]],
  ["plant", ["planta", "maceta", "jardin"]],
  ["cushion", ["cojin", "textil", "manta", "cobija", "almohada"]],
  ["lamp", ["lampara", "decoracion", "iluminacion", "decorativ"]],
  ["mug", ["taza", "cocina", "vaso", "cafe"]],
  ["spray", ["limpieza", "detergente", "jabon", "desinfect", "cloro"]],
  ["bottle", ["bebida", "agua", "refresco", "jugo", "leche"]],
  ["jar", ["creatina", "despensa", "arroz", "frasco", "mermelada", "abarrote", "enlatado"]],
  ["bag", ["accesorio", "bolsa", "mochila", "cartera"]],
];

/** Minúsculas y sin acentos, para comparar con las reglas. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Objeto para un nombre; `fallback` si ninguna palabra coincide. */
export function goodFor(name: string, fallback: Good = "tag"): Good {
  const text = normalize(name);
  for (const [good, words] of RULES) {
    if (words.some((w) => text.includes(w))) return good;
  }
  return fallback;
}

/**
 * Objetos distintos para el anaquel del hero, en el orden de los nombres dados
 * (normalmente las categorías de la portada). Sin coincidencias: bolsa, etiqueta
 * y caja, que sirven para cualquier giro.
 */
export function shelfFor(names: readonly string[], max = 5): Good[] {
  const picked: Good[] = [];
  for (const name of names) {
    const good = goodFor(name, "tag");
    if (good !== "tag" && !picked.includes(good)) picked.push(good);
    if (picked.length === max) break;
  }
  if (picked.length >= 3) return picked;
  for (const extra of ["bag", "tag", "box"] as const) {
    if (picked.length >= 3) break;
    if (!picked.includes(extra)) picked.push(extra);
  }
  return picked;
}
