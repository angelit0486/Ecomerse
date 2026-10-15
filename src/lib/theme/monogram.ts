/**
 * Monograma de la tienda (GATE0 §20.2: favicon por defecto = inicial + color
 * primario). Puro y sin HTML del comerciante: la inicial se limita a una letra o
 * número y los colores pasan por la lista blanca de `resolveTheme`.
 */
export function monogramInitial(name: string): string {
  const first = [...name.normalize("NFC").trim()].find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return first ? first.toLocaleUpperCase("es-MX") : "•";
}

const HEX_RE = /^#[0-9a-f]{6}$/;

export function monogramSvg(name: string, background: string, foreground: string): string {
  const bg = HEX_RE.test(background) ? background : "#111827";
  const fg = HEX_RE.test(foreground) ? foreground : "#ffffff";
  // Una sola letra o número (o •): no hay nada que escapar, pero se escapa igual.
  const initial = monogramInitial(name).replace(/[<>&"']/g, "");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
    `<rect width="64" height="64" rx="14" fill="${bg}"/>`,
    `<text x="32" y="32" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="${fg}">${initial}</text>`,
    "</svg>",
  ].join("");
}
