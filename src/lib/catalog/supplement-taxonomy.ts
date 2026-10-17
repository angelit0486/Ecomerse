/**
 * Estructura base de categorías para una tienda de suplementos (pedida por el
 * propietario, misión del 2026-10-17). Solo nombres y direcciones: ninguna
 * descripción ni afirmación de salud. La tienda las crea con un clic y después
 * las edita, oculta o elimina como cualquier otra categoría.
 */
export interface SuggestedCategory {
  name: string;
  slug: string;
}

export const SUPPLEMENT_CATEGORIES: readonly SuggestedCategory[] = [
  { name: "Proteínas", slug: "proteinas" },
  { name: "Preentrenos y energía", slug: "preentrenos-y-energia" },
  { name: "Creatina", slug: "creatina" },
  { name: "Aminoácidos", slug: "aminoacidos" },
  { name: "Vitaminas y minerales", slug: "vitaminas-y-minerales" },
  { name: "Salud y bienestar", slug: "salud-y-bienestar" },
  { name: "Ganadores de masa", slug: "ganadores-de-masa" },
  { name: "Accesorios deportivos", slug: "accesorios-deportivos" },
];

/** Minúsculas, sin acentos ni espacios repetidos: «Proteínas » = «proteinas». */
export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Las sugeridas que la tienda aún no tiene en el primer nivel. Cuenta como
 * existente la que coincide por dirección o por nombre, aunque esté oculta: lo
 * que la dueña ya decidió no se vuelve a crear.
 */
export function missingSupplementCategories(
  existing: readonly { name: string; slug: string; depth: number }[],
): SuggestedCategory[] {
  const top = existing.filter((c) => c.depth === 0);
  const slugs = new Set(top.map((c) => c.slug));
  const names = new Set(top.map((c) => normalizeName(c.name)));
  return SUPPLEMENT_CATEGORIES.filter(
    (s) => !slugs.has(s.slug) && !names.has(normalizeName(s.name)),
  );
}
