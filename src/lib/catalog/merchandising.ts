/**
 * Datos de venta de la ficha y las tarjetas (F9-DESIGN §9): ahorro, precio por
 * porción e insignias. Todo sale de datos verificables del catálogo; nada se
 * inventa ni se exagera. Dinero en centavos enteros, con BigInt (GATE0 §44.14).
 */

export interface Savings {
  /** Centavos que se ahorran. */
  amount: number;
  /** Porcentaje redondeado hacia abajo: nunca exagera el descuento. */
  percent: number;
}

/** Ahorro frente al precio de comparación; null si no hay un descuento real. */
export function savings(price: number, compareAt: number | null | undefined): Savings | null {
  if (compareAt == null || !Number.isSafeInteger(price) || !Number.isSafeInteger(compareAt)) {
    return null;
  }
  if (price < 0 || compareAt <= price) return null;
  const diff = BigInt(compareAt) - BigInt(price);
  return { amount: Number(diff), percent: Number((diff * 100n) / BigInt(compareAt)) };
}

/**
 * Precio por porción en centavos, redondeado al centavo más cercano (mitad
 * hacia arriba). Solo con un número de porciones declarado en la ficha
 * sanitaria; si no, null.
 */
export function pricePerServing(price: number, servings: number | null | undefined): number | null {
  if (servings == null || !Number.isSafeInteger(servings) || servings < 1) return null;
  if (!Number.isSafeInteger(price) || price < 0) return null;
  const p = BigInt(price);
  const s = BigInt(servings);
  return Number((p * 2n + s) / (2n * s));
}

export type Badge = "sale" | "new" | "low_stock" | "sold_out";

export const BADGE_LABELS: Record<Badge, string> = {
  sale: "Oferta",
  new: "Nuevo",
  low_stock: "Últimas piezas",
  sold_out: "Agotado",
};

/** Días que un producto publicado cuenta como «Nuevo». */
export const NEW_DAYS = 30;

/**
 * Insignias estructurales (F9-DESIGN §9): «Oferta» con precio de comparación
 * mayor; «Nuevo» con publicación de hace ≤ 30 días; «Últimas piezas» con el
 * estado de stock bajo (nunca la cantidad); «Agotado». Agotado reemplaza a
 * «Últimas piezas» y a «Oferta» (no se anuncia lo que no se puede comprar).
 */
export function productBadges(input: {
  price: number | null;
  compareAt: number | null | undefined;
  availability: "in_stock" | "low_stock" | "backorder" | "out_of_stock";
  publishedAt: string | null | undefined;
  now: Date;
}): Badge[] {
  if (input.availability === "out_of_stock") return ["sold_out"];
  const badges: Badge[] = [];
  if (input.price !== null && savings(input.price, input.compareAt)) badges.push("sale");
  if (input.publishedAt) {
    const published = Date.parse(input.publishedAt);
    const age = input.now.getTime() - published;
    if (Number.isFinite(published) && age >= 0 && age <= NEW_DAYS * 86_400_000) badges.push("new");
  }
  if (input.availability === "low_stock") badges.push("low_stock");
  return badges;
}
