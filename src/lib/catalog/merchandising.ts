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
 * Días después de la apertura de la tienda a partir de los cuales una
 * publicación cuenta como novedad: el catálogo con el que abre no es «Nuevo»
 * (revisión de conversión, M8: cuando todo es nuevo, nada lo es).
 */
export const NEW_AFTER_LAUNCH_DAYS = 7;

const DAY_MS = 86_400_000;

/** Prioridad de la única insignia que se muestra (revisión de conversión, M8). */
const PRIORITY: Badge[] = ["sold_out", "sale", "low_stock", "new"];

/**
 * Insignia estructural de un producto (F9-DESIGN §9), como máximo una:
 * «Agotado» > «Oferta» (precio de comparación mayor) > «Últimas piezas» (estado
 * de stock bajo, nunca la cantidad) > «Nuevo» (publicado hace ≤ 30 días y al
 * menos 7 días después de la apertura de la tienda).
 */
export function productBadges(input: {
  price: number | null;
  compareAt: number | null | undefined;
  availability: "in_stock" | "low_stock" | "backorder" | "out_of_stock";
  publishedAt: string | null | undefined;
  launchedAt: string | null | undefined;
  now: Date;
}): Badge[] {
  const found = new Set<Badge>();
  if (input.availability === "out_of_stock") found.add("sold_out");
  if (input.price !== null && savings(input.price, input.compareAt)) found.add("sale");
  if (input.availability === "low_stock") found.add("low_stock");
  if (input.publishedAt && input.launchedAt) {
    const published = Date.parse(input.publishedAt);
    const launched = Date.parse(input.launchedAt);
    const age = input.now.getTime() - published;
    if (
      Number.isFinite(published) &&
      Number.isFinite(launched) &&
      age >= 0 &&
      age <= NEW_DAYS * DAY_MS &&
      published - launched >= NEW_AFTER_LAUNCH_DAYS * DAY_MS
    ) {
      found.add("new");
    }
  }
  const first = PRIORITY.find((b) => found.has(b));
  return first ? [first] : [];
}

export interface FreeShippingProgress {
  /** Centavos que faltan; 0 si ya se alcanzó. */
  remaining: number;
  reached: boolean;
  /** Avance de 0 a 100, hacia abajo (la barra nunca se adelanta). */
  percent: number;
}

/**
 * Avance hacia el envío gratis (F9-T04). Misma base que `app.calculate_cart`:
 * el subtotal ya descontado (§17.3.4). La barra es informativa: el envío lo
 * calcula siempre la base.
 */
export function freeShippingProgress(
  subtotal: number,
  discountTotal: number,
  threshold: number,
): FreeShippingProgress | null {
  if (![subtotal, discountTotal, threshold].every(Number.isSafeInteger) || threshold <= 0) {
    return null;
  }
  const base = BigInt(Math.max(subtotal - discountTotal, 0));
  const goal = BigInt(threshold);
  if (base >= goal) return { remaining: 0, reached: true, percent: 100 };
  return { remaining: Number(goal - base), reached: false, percent: Number((base * 100n) / goal) };
}
