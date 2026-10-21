/**
 * Logos de varias marcas a la vez (misión Portada/Marcas, Paso 2): cada archivo
 * se asigna a la marca cuyo nombre coincide con el nombre del archivo
 * («muha-meds-logo.png» → «Muha Meds»). Sin acentos, mayúsculas ni separadores,
 * y sin palabras de relleno como «logo» o «final».
 */
const FILLER = new Set([
  "logo",
  "logotipo",
  "marca",
  "brand",
  "final",
  "hd",
  "png",
  "jpg",
  "copia",
  "copy",
]);

export function brandKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d{1,2}$/.test(w))
    .join("");
}

export interface BrandRef {
  id: string;
  name: string;
  slug: string;
}

/** La marca del archivo, o null si ninguna coincide (o si coinciden varias). */
export function matchBrandFile<B extends BrandRef>(fileName: string, brands: B[]): B | null {
  const key = brandKey(fileName);
  if (!key) return null;
  const hits = brands.filter((b) => brandKey(b.name) === key || brandKey(b.slug) === key);
  return hits.length === 1 ? hits[0]! : null;
}
