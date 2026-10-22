/**
 * Barra de categorías del encabezado (misión Panel, Paso D; tema v4). Decide
 * qué enlaces se ven y cuál es el de la página actual. Puro: lo usan la tienda
 * (servidor y navegador) y las pruebas.
 */
export type NavVisibility = "all" | "mobile" | "desktop";

export interface NavBarItem {
  label: string;
  href: string;
  visibility: NavVisibility;
}

export interface NavBarConfig {
  items?: { label: string; link: string; visibility?: NavVisibility }[];
  style?: "text" | "pills" | "photos";
  sticky?: boolean;
  align?: "start" | "center";
  size?: "sm" | "md";
  visibility?: "mobile" | "all";
}

/**
 * Enlaces de la barra, en orden de preferencia:
 * 1. los elegidos en la barra (tema v4);
 * 2. los accesos rápidos de antes (tema v2, hasta 4);
 * 3. automáticos: «Ofertas» (si hay), «Más vendidos», el menú y los accesos
 *    con contenido (como antes).
 */
export function navBarItems(input: {
  config?: NavBarConfig | undefined;
  quickLinks?: { label: string; link: string }[] | undefined;
  menu: { label: string; href: string; children: { label: string; href: string }[] }[];
  discovery: { label: string; href: string }[];
}): NavBarItem[] {
  const chosen = input.config?.items;
  if (chosen && chosen.length > 0) {
    return chosen.map((i) => ({ label: i.label, href: i.link, visibility: i.visibility ?? "all" }));
  }
  if (input.quickLinks && input.quickLinks.length > 0) {
    return input.quickLinks.map((q) => ({ label: q.label, href: q.link, visibility: "all" }));
  }
  const offers = input.discovery.find((d) => d.href === "/ofertas");
  const leaves = input.menu.flatMap((m) => (m.children.length > 0 ? m.children : [m]));
  return [
    ...(offers ? [offers] : []),
    { label: "Más vendidos", href: "/productos?orden=best_selling" },
    ...leaves,
    ...input.discovery.filter((d) => d.href !== "/ofertas"),
  ]
    .filter((link, i, all) => all.findIndex((l) => l.href === link.href) === i)
    .slice(0, 12)
    .map((l) => ({ label: l.label, href: l.href, visibility: "all" as const }));
}

/**
 * Índice del enlace de la página actual, o -1. Coincide la ruta y todos los
 * parámetros del enlace; si varios coinciden, gana el más específico (así
 * «/productos?objetivo=energia» le gana a «/productos»). Los enlaces externos
 * nunca están activos.
 */
export function activeNavIndex(
  items: ReadonlyArray<{ href: string }>,
  pathname: string,
  search: string,
): number {
  const current = new URLSearchParams(search);
  let best = -1;
  let bestScore = -1;
  items.forEach((item, index) => {
    if (!item.href.startsWith("/")) return;
    const url = new URL(item.href, "https://tienda.invalid");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const here = pathname.replace(/\/+$/, "") || "/";
    if (path !== here) return;
    const params = [...url.searchParams.entries()];
    if (!params.every(([k, v]) => current.get(k) === v)) return;
    // «/productos» solo cuenta si la página no tiene filtros propios de otro enlace.
    const score = params.length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}
