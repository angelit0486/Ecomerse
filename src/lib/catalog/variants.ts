/**
 * Generador de combinaciones de variantes (GATE0 §14.1). Puro: lo usa el editor
 * del panel y sus pruebas. Firma = "Opción=Valor|…" en el orden de las opciones,
 * igual que app.variant_expected_signature en la base.
 */
export interface OptionInput {
  name: string;
  values: string[];
}

export type OptionSelection = Record<string, string>;

export const MAX_OPTIONS = 3;
export const DEFAULT_MAX_VARIANTS = 100;

/** Producto cartesiano de los valores, en el orden de las opciones. */
export function generateCombinations(options: readonly OptionInput[]): OptionSelection[] {
  const clean = options
    .map((o) => ({
      name: o.name.trim(),
      values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((o) => o.name && o.values.length > 0);
  return clean.reduce<OptionSelection[]>(
    (acc, option) =>
      acc.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value }))),
    [{}],
  );
}

export function signatureOf(options: readonly OptionInput[], selection: OptionSelection): string {
  return options
    .filter((o) => selection[o.name.trim()] !== undefined)
    .map((o) => `${o.name.trim()}=${selection[o.name.trim()]}`)
    .join("|");
}

/** Etiqueta legible: "Negro / M". */
export function selectionLabel(
  options: readonly OptionInput[],
  selection: OptionSelection,
): string {
  return options
    .map((o) => selection[o.name.trim()])
    .filter(Boolean)
    .join(" / ");
}
