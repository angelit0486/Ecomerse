import { INTERNAL_PATH_RE } from "./links";

/**
 * Enlaces internos que no llevan a ninguna página (diagnóstico de la portada,
 * DIAGNOSTICO-PORTADA.md R3): la dueña escribió «/plumas» en el botón de la
 * portada y la tienda tiene «/categoria/plumas». Solo avisa con una sugerencia;
 * no bloquea el guardado (un rol sin permiso de SEO no ve las redirecciones).
 */
export interface LinkTargets {
  /** `path` de las categorías visibles (p. ej. «suplementos/proteinas»). */
  categories: string[];
  brands: string[];
  pages: string[];
  products: string[];
  /** Rutas de origen de las redirecciones 301 (ya llevan a otra página). */
  redirects: string[];
}

/** Páginas fijas de la tienda (src/app/_store/[storeId]). */
const STATIC_PATHS = new Set([
  "/",
  "/productos",
  "/ofertas",
  "/marcas",
  "/buscar",
  "/carrito",
  "/cuenta",
  "/checkout",
]);

const PREFIXES = [
  { prefix: "/categoria/", key: "categories" },
  { prefix: "/marca/", key: "brands" },
  { prefix: "/paginas/", key: "pages" },
  { prefix: "/productos/", key: "products" },
] as const;

const NAMES: Record<(typeof PREFIXES)[number]["key"], string> = {
  categories: "categoría",
  brands: "marca",
  pages: "página",
  products: "producto",
};

function pathOf(link: string): string {
  const bare = link.split(/[?#]/, 1)[0] ?? "";
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // Se compara tal cual.
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
}

/** Lo que el comprador ve si sigue el enlace; null si lleva a una página real (o es externo). */
export function brokenLinkHint(link: string, targets: LinkTargets): string | null {
  if (!link || !INTERNAL_PATH_RE.test(link)) return null;
  const path = pathOf(link);
  if (STATIC_PATHS.has(path)) return null;
  if (targets.redirects.some((r) => pathOf(r) === path)) return null;
  for (const { prefix, key } of PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (targets[key].includes(rest)) return null;
    return `«${link}» no lleva a ninguna ${NAMES[key]} de tu tienda.${suggest(rest, targets)}`;
  }
  return `«${link}» no es una página de tu tienda.${suggest(path.slice(1), targets)}`;
}

/** «¿Quisiste decir …?» con la página cuyo nombre corto coincide. */
function suggest(slug: string, targets: LinkTargets): string {
  const last = slug.split("/").pop()?.toLowerCase();
  if (!last) return "";
  const category = targets.categories.find((p) => p.split("/").pop() === last);
  const found = category
    ? `/categoria/${category}`
    : targets.brands.includes(last)
      ? `/marca/${last}`
      : targets.pages.includes(last)
        ? `/paginas/${last}`
        : targets.products.includes(last)
          ? `/productos/${last}`
          : null;
  return found ? ` ¿Quisiste decir «${found}»?` : "";
}

/** Los enlaces de un bloque de la portada (botones, tarjetas y renglones). */
export function sectionLinks(props: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (key === "link" || key === "href") out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(props);
  return out;
}
