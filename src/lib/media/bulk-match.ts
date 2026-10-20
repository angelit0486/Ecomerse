/**
 * Subida de fotos en lote: decide a qué producto va cada archivo por su nombre.
 *
 *   PRV-001.jpg            → producto con el SKU PRV-001 (foto 1)
 *   PRV-001-2.jpg          → mismo producto, foto 2 («_2» y « 2» también valen)
 *   proteina-aislada.webp  → producto con ese nombre corto (slug)
 *   PRV-001-CHO.jpg        → si es el SKU de un sabor o tamaño de un producto con
 *                            varias presentaciones, además es la foto de ese sabor
 *
 * Sin distinguir mayúsculas. Se prueba primero el nombre completo y después sin
 * el número final: así un SKU que termina en número no se confunde con la foto 2.
 */

export interface MatchTarget {
  id: string;
  title: string;
  slug: string;
  skus: readonly string[];
  /** Presentaciones con SKU; solo importan si el producto tiene más de una. */
  variants?: readonly { id: string; sku: string }[];
}

export interface FileMatch {
  index: number;
  name: string;
  /** null: no coincide con ningún producto. */
  productId: string | null;
  productTitle: string | null;
  matchedBy: "sku" | "nombre" | null;
  /** Orden dentro del producto (1 = principal). */
  order: number;
  /** El mismo SKU está en varios productos: no se asigna para no adivinar. */
  ambiguous: boolean;
  /** Presentación cuyo SKU es el nombre exacto del archivo (foto de ese sabor). */
  variantId: string | null;
  variantSku: string | null;
}

const SUFFIX = /^(.*?)[-_ ](\d{1,2})$/;

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function stem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

interface Index {
  bySku: Map<string, MatchTarget[]>;
  bySlug: Map<string, MatchTarget>;
}

function buildIndex(targets: readonly MatchTarget[]): Index {
  const bySku = new Map<string, MatchTarget[]>();
  const bySlug = new Map<string, MatchTarget>();
  for (const target of targets) {
    bySlug.set(normalizeKey(target.slug), target);
    for (const sku of new Set(target.skus.map(normalizeKey))) {
      if (!sku) continue;
      const list = bySku.get(sku) ?? [];
      if (!list.includes(target)) list.push(target);
      bySku.set(sku, list);
    }
  }
  return { bySku, bySlug };
}

function lookup(
  key: string,
  index: Index,
): { target: MatchTarget | null; by: "sku" | "nombre" | null; ambiguous: boolean } {
  const skuHits = index.bySku.get(key);
  if (skuHits && skuHits.length > 1) return { target: null, by: "sku", ambiguous: true };
  if (skuHits?.[0]) return { target: skuHits[0], by: "sku", ambiguous: false };
  const slugHit = index.bySlug.get(key);
  if (slugHit) return { target: slugHit, by: "nombre", ambiguous: false };
  return { target: null, by: null, ambiguous: false };
}

export function matchFiles(
  fileNames: readonly string[],
  targets: readonly MatchTarget[],
): FileMatch[] {
  const index = buildIndex(targets);
  return fileNames.map((name, i) => {
    const key = normalizeKey(stem(name));
    let found = lookup(key, index);
    let order = 1;
    const suffix = SUFFIX.exec(key);
    if (!found.target && !found.ambiguous && suffix) {
      const withoutNumber = lookup(suffix[1]!, index);
      if (withoutNumber.target || withoutNumber.ambiguous) {
        found = withoutNumber;
        order = Math.max(1, Number(suffix[2]));
      }
    }
    // Solo con el SKU exacto (sin número de foto) y si hay varias presentaciones:
    // con una sola, la foto del producto ya es la suya.
    const variants = found.target?.variants ?? [];
    const variant =
      found.by === "sku" && order === 1 && variants.length > 1
        ? (variants.find((v) => normalizeKey(v.sku) === key) ?? null)
        : null;
    return {
      index: i,
      name,
      productId: found.target?.id ?? null,
      productTitle: found.target?.title ?? null,
      matchedBy: found.by,
      order,
      ambiguous: found.ambiguous,
      variantId: variant?.id ?? null,
      variantSku: variant?.sku ?? null,
    };
  });
}

/** Orden de subida: por producto y, dentro de cada uno, foto 1, 2, 3… */
export function uploadOrder(matches: readonly FileMatch[]): FileMatch[] {
  return matches
    .filter((m) => m.productId)
    .slice()
    .sort(
      (a, b) =>
        a.productId!.localeCompare(b.productId!) ||
        a.order - b.order ||
        a.name.localeCompare(b.name, "es"),
    );
}
