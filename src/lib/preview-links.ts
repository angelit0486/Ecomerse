/**
 * Enlaces a las tiendas de demostración que la portada del panel muestra en la
 * vista previa (D-F9-17). Formato de PREVIEW_STORE_LINKS:
 * "Etiqueta|https://host,Otra etiqueta|https://otro-host". Solo https y como
 * máximo 6; lo que no cumple se ignora (nunca rompe la página).
 */
export interface PreviewLink {
  label: string;
  url: string;
}

const MAX_LINKS = 6;

export function parsePreviewLinks(raw: string | undefined): PreviewLink[] {
  if (!raw) return [];
  const links: PreviewLink[] = [];
  for (const entry of raw.split(",")) {
    const [label = "", url = ""] = entry.split("|").map((part) => part.trim());
    if (!label || label.length > 60) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
      links.push({ label, url: parsed.origin + parsed.pathname });
    } catch {
      continue;
    }
    if (links.length === MAX_LINKS) break;
  }
  return links;
}
