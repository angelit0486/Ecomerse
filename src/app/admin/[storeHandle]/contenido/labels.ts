export const PAGE_TYPE_LABELS: Record<string, string> = {
  content: "Página",
  policy_privacy: "Aviso de privacidad",
  policy_terms: "Términos y condiciones",
  policy_returns: "Cambios y devoluciones",
  policy_shipping: "Envíos",
};

export const LINK_TYPE_LABELS: Record<string, string> = {
  home: "Inicio",
  category: "Categoría",
  brand: "Marca",
  product: "Producto",
  page: "Página",
  search: "Búsqueda",
  filter: "Objetivo o filtro",
  url: "Dirección web",
};

/** "objetivo=energia" → "/productos?objetivo=energia". */
export function filterHref(id: string): string {
  const [attribute = "", value = ""] = id.split("=");
  return `/productos?${new URLSearchParams([[attribute, value]]).toString()}`;
}
