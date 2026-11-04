/**
 * Teléfono de la dirección de envío. La base solo acepta dígitos, espacios,
 * paréntesis, guiones y un «+» inicial (7 a 20 caracteres). Los compradores
 * escriben también puntos, diagonales, guiones largos o «ext.»: se convierten
 * aquí, antes de guardar, para no rechazar un teléfono válido.
 */
export function normalizePhone(raw: string): string {
  let s = raw.normalize("NFKC").trim();
  // La extensión no la usa la paquetería.
  s = s.replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d+\s*$/i, "");
  const plus = s.startsWith("+");
  s = s
    .replace(/[‐-―−]/g, "-")
    .replace(/[./\\_·]/g, " ")
    .replace(/[^0-9 ()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? (plus ? `+${s}` : s).slice(0, 20).trim() : "";
}
