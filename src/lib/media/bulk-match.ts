/**
 * Subida de fotos en lote: decide a qué producto va cada archivo por su nombre.
 *
 *   PRV-001.jpg            → producto con el SKU PRV-001 (foto 1)
 *   PRV-001-2.jpg          → mismo producto, foto 2 («_2» y « 2» también valen)
 *   proteina-aislada.webp  → producto con ese nombre corto (slug)
 *   PRV-001-CHO.jpg        → si es el SKU de un sabor o tamaño de un producto con
 *                            varias presentaciones, además es la foto de ese sabor
 *
 * Sin distinguir mayúsculas ni acentos. Se prueba primero el nombre completo y
 * después sin el número final: así un SKU que termina en número no se confunde
 * con la foto 2. El nombre del producto también vale («Proteína Aislada.jpg»).
 *
 * Carpeta por producto (para catálogos grandes, sin renombrar fotos):
 *
 *   PRV-001/frente.jpg     → si el archivo no dice a qué producto va, decide la
 *   PRV-001/lado.jpg         carpeta que lo contiene (SKU, nombre corto o nombre);
 *   Proteína aislada/1.jpg   el orden es el de los nombres de archivo (1, 2, 10…)
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
  /** «carpeta»: lo decidió la carpeta que contiene la foto, no su nombre. */
  matchedVia: "archivo" | "carpeta" | null;
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
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function stem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Carpeta que contiene el archivo («Tienda/PRV-001/frente.jpg» → «PRV-001»). */
export function parentFolder(path: string): string | null {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2]! : null;
}

interface Index {
  bySku: Map<string, MatchTarget[]>;
  /** Nombre corto y nombre del producto; varios productos con el mismo nombre = ambiguo. */
  byName: Map<string, MatchTarget[]>;
}

function addName(map: Map<string, MatchTarget[]>, key: string, target: MatchTarget) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.includes(target)) list.push(target);
  map.set(key, list);
}

function buildIndex(targets: readonly MatchTarget[]): Index {
  const bySku = new Map<string, MatchTarget[]>();
  const byName = new Map<string, MatchTarget[]>();
  for (const target of targets) {
    addName(byName, normalizeKey(target.slug), target);
    addName(byName, normalizeKey(target.title), target);
    for (const sku of new Set(target.skus.map(normalizeKey))) {
      if (!sku) continue;
      const list = bySku.get(sku) ?? [];
      if (!list.includes(target)) list.push(target);
      bySku.set(sku, list);
    }
  }
  return { bySku, byName };
}

function lookup(
  key: string,
  index: Index,
): { target: MatchTarget | null; by: "sku" | "nombre" | null; ambiguous: boolean } {
  const skuHits = index.bySku.get(key);
  if (skuHits && skuHits.length > 1) return { target: null, by: "sku", ambiguous: true };
  if (skuHits?.[0]) return { target: skuHits[0], by: "sku", ambiguous: false };
  const nameHits = index.byName.get(key);
  if (nameHits && nameHits.length > 1) return { target: null, by: "nombre", ambiguous: true };
  if (nameHits?.[0]) return { target: nameHits[0], by: "nombre", ambiguous: false };
  return { target: null, by: null, ambiguous: false };
}

/** Orden natural: «2.jpg» antes que «10.jpg». */
const natural = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * `fileNames` puede traer la ruta relativa («Tienda/PRV-001/frente.jpg»): así
 * llegan las fotos al elegir o arrastrar una carpeta completa.
 */
export function matchFiles(
  fileNames: readonly string[],
  targets: readonly MatchTarget[],
): FileMatch[] {
  const index = buildIndex(targets);
  // Posición de cada archivo entre los de su carpeta, en orden natural.
  const siblings = new Map<string, string[]>();
  for (const name of fileNames) {
    const folder = parentFolder(name);
    if (!folder) continue;
    const key = name.slice(0, name.length - (name.split(/[\\/]/).pop() ?? "").length);
    siblings.set(key, [...(siblings.get(key) ?? []), name]);
  }
  for (const list of siblings.values()) list.sort((a, b) => natural.compare(stem(a), stem(b)));

  return fileNames.map((name, i) => {
    const key = normalizeKey(stem(name));
    let found = lookup(key, index);
    let order = 1;
    let via: FileMatch["matchedVia"] = found.target ? "archivo" : null;
    const suffix = SUFFIX.exec(key);
    if (!found.target && !found.ambiguous && suffix) {
      const withoutNumber = lookup(suffix[1]!, index);
      if (withoutNumber.target || withoutNumber.ambiguous) {
        found = withoutNumber;
        order = Math.max(1, Number(suffix[2]));
        via = withoutNumber.target ? "archivo" : null;
      }
    }
    // El nombre del archivo no dice nada («IMG_2041.jpg»): decide su carpeta.
    const folder = parentFolder(name);
    if (!found.target && !found.ambiguous && folder) {
      const byFolder = lookup(normalizeKey(folder), index);
      if (byFolder.target || byFolder.ambiguous) {
        found = byFolder;
        via = byFolder.target ? "carpeta" : null;
        const dir = name.slice(0, name.length - (name.split(/[\\/]/).pop() ?? "").length);
        order = (siblings.get(dir)?.indexOf(name) ?? 0) + 1;
      }
    }
    // Solo con el SKU exacto (sin número de foto) y si hay varias presentaciones:
    // con una sola, la foto del producto ya es la suya.
    const variants = found.target?.variants ?? [];
    const variant =
      via === "archivo" && found.by === "sku" && order === 1 && variants.length > 1
        ? (variants.find((v) => normalizeKey(v.sku) === key) ?? null)
        : null;
    return {
      index: i,
      name,
      productId: found.target?.id ?? null,
      productTitle: found.target?.title ?? null,
      matchedBy: found.by,
      matchedVia: via,
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
