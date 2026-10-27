/**
 * Copias de una foto en varios anchos (paso 8, auditoría REN-01). Viven junto al
 * archivo publicado, en `{ruta}.w{ancho}.webp`: el contrato de rutas de Storage
 * (GATE0 §43) no cambia y el prefijo de la tienda se conserva.
 */
export const VARIANT_WIDTHS = [320, 640, 960, 1280] as const;

export function variantPath(path: string, width: number): string {
  return `${path}.w${width}.webp`;
}

/**
 * Solo las rutas canónicas (`…/original.{ext}`) tienen copias: el worker no las
 * genera para otras formas (p. ej., datos sembrados a mano), así que tampoco se
 * piden.
 */
export function hasVariants(path: string): boolean {
  return /\/original\.(jpg|png|webp|avif)$/.test(path);
}

/** Solo anchos menores que el original: nunca se agranda una foto. */
export function variantWidthsFor(originalWidth: number | null | undefined): number[] {
  if (!originalWidth || originalWidth <= 0) return [];
  return VARIANT_WIDTHS.filter((w) => w < originalWidth);
}

/**
 * `srcset` con las copias y el original. Sin ancho conocido o sin copias, null:
 * el `<img>` queda como antes, con solo `src`.
 */
export function buildSrcSet(
  url: (path: string) => string,
  path: string,
  originalWidth: number | null | undefined,
): string | null {
  const widths = variantWidthsFor(originalWidth);
  if (widths.length === 0 || !originalWidth || !hasVariants(path)) return null;
  return [
    ...widths.map((w) => `${url(variantPath(path, w))} ${w}w`),
    `${url(path)} ${originalWidth}w`,
  ].join(", ");
}
