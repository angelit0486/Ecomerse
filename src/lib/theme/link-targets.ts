import { INTERNAL_PATH_RE } from "./links";

/**
 * Enlaces internos que no llevan a ninguna página (diagnóstico de la portada,
 * DIAGNOSTICO-PORTADA.md R3): la dueña escribió «/plumas» en el botón de la
 * portada y la tienda tiene «/categoria/plumas». Solo avisa con una sugerencia;
 * no bloquea el guardado (un rol sin permiso de SEO no ve las redirecciones).
 */
export interface LinkTargets {
  /**
   * `path` de las categorías visibles (p. ej. «suplementos/proteinas»). `null`
   * en cualquier lista = no se pudo saber (sin permiso o la consulta falló):
   * entonces no se avisa nada de ese tipo de enlace (revisión del Paso 1).
   */
  categories: string[] | null;
  brands: string[] | null;
  pages: string[] | null;
  products: string[] | null;
  /** Rutas de origen de las redirecciones 301 (ya llevan a otra página). */
  redirects: string[] | null;
}

/** Páginas fijas de la tienda (src/app/_store/[storeId]). */
const STATIC_PATHS = new Set([
  "/",
  "/productos",
  "/ofertas",
  "/marcas",
  "/buscar",
  "/carrito",
  "/checkout",
]);
/** Secciones con rutas propias (cuenta del comprador, pedido, pago). */
const STATIC_PREFIXES = ["/cuenta", "/pedido/", "/pago-simulado/"];

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
  if (STATIC_PATHS.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) return null;
  // Sin saber qué redirecciones hay, cualquier otra ruta podría ser una.
  if (targets.redirects === null) return null;
  // Las redirecciones se guardan y se comparan en minúsculas (redirects.ts).
  if (targets.redirects.some((r) => pathOf(r).toLowerCase() === path.toLowerCase())) return null;
  for (const { prefix, key } of PREFIXES) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const known = targets[key];
    if (known === null || known.includes(rest)) return null;
    return `«${link}» no lleva a ninguna ${NAMES[key]} de tu tienda.${suggest(rest, targets)}`;
  }
  return `«${link}» no es una página de tu tienda.${suggest(path.slice(1), targets)}`;
}

/** «¿Quisiste decir …?» con la página cuyo nombre corto coincide. */
function suggest(slug: string, targets: LinkTargets): string {
  const last = slug.split("/").pop()?.toLowerCase();
  if (!last) return "";
  const category = targets.categories?.find((p) => p.split("/").pop() === last);
  const found = category
    ? `/categoria/${category}`
    : targets.brands?.includes(last)
      ? `/marca/${last}`
      : targets.pages?.includes(last)
        ? `/paginas/${last}`
        : targets.products?.includes(last)
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
