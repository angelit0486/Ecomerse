/**
 * Sugerencias del alta rápida de productos (misión panel, Fase 1): a partir del
 * nombre que escribe la dueña, propone marca y categoría de entre las que ya
 * existen en su tienda. Solo propone; ella confirma. Funciones puras.
 */

export type ProductTemplate = "supplement" | "apparel" | "general";

export const TEMPLATES: Record<ProductTemplate, { label: string; hint: string }> = {
  supplement: {
    label: "Suplemento",
    hint: "Pide contenido neto y porciones; la ficha sanitaria se llena después de crearlo.",
  },
  apparel: {
    label: "Ropa o accesorio",
    hint: "Después de crearlo agrega tallas o colores en la ficha.",
  },
  general: { label: "Otro", hint: "Solo lo básico." },
};

/** Minúsculas, sin acentos ni signos: «Proteína Whey» → ["proteina", "whey"]. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

/** Singular sencillo para comparar «Proteínas» con «proteína». */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** La marca cuyo nombre completo aparece en el nombre del producto (la más larga gana). */
export function suggestBrand<T extends { id: string; name: string }>(
  title: string,
  brands: readonly T[],
): T | null {
  const haystack = ` ${words(title).join(" ")} `;
  let best: T | null = null;
  let bestLength = 0;
  for (const brand of brands) {
    const needle = words(brand.name).join(" ");
    if (needle.length > bestLength && haystack.includes(` ${needle} `)) {
      best = brand;
      bestLength = needle.length;
    }
  }
  return best;
}

/**
 * La categoría cuyo nombre aparece más completo en el nombre del producto
 * (proporción de sus palabras presentes); si empatan, la que comparte más
 * palabras y después la más específica. Sin coincidencias, ninguna.
 */
export function suggestCategory<T extends { id: string; name: string; depth?: number }>(
  title: string,
  categories: readonly T[],
): T | null {
  const titleWords = new Set(words(title).map(stem));
  let best: { category: T; ratio: number; matched: number } | null = null;
  for (const category of categories) {
    const names = words(category.name).map(stem);
    const matched = names.filter((w) => titleWords.has(w)).length;
    if (matched === 0) continue;
    const ratio = matched / names.length;
    const better =
      !best ||
      ratio > best.ratio ||
      (ratio === best.ratio &&
        (matched > best.matched ||
          (matched === best.matched && (category.depth ?? 0) > (best.category.depth ?? 0))));
    if (better) best = { category, ratio, matched };
  }
  return best?.category ?? null;
}

/**
 * Porciones más comunes para cada contenido neto ya capturado en la tienda
 * («907 g» → 30), para proponerlas al dar de alta otra presentación igual.
 */
export function servingsByContent(
  rows: readonly { net_content: string | null; servings_per_container: number | null }[],
): Record<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const { net_content, servings_per_container } of rows) {
    if (!net_content || !servings_per_container) continue;
    const key = net_content.trim().toLowerCase();
    const byServings = counts.get(key) ?? new Map<number, number>();
    byServings.set(servings_per_container, (byServings.get(servings_per_container) ?? 0) + 1);
    counts.set(key, byServings);
  }
  const result: Record<string, number> = {};
  for (const [key, byServings] of counts) {
    result[key] = [...byServings].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  }
  return result;
}
