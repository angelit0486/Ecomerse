/**
 * Emparejamiento de variantes en el editor cuando cambian las opciones (Gate F3):
 * una variante existente conserva su id, SKU, código de barras, precio y costo
 * al agregar, quitar o renombrar opciones o valores, en lugar de recrearse.
 */
export interface DraftLike {
  options: Record<string, string>;
}

const norm = (text: string) => text.trim().toLowerCase();

/**
 * Para cada combinación, el índice del borrador que la representa (o -1). Primero
 * coincidencias exactas; luego la que comparte más valores sin contradecir
 * ninguno (p. ej. la variante única al agregar la primera opción). Cada
 * borrador se usa una sola vez.
 */
export function matchDrafts(
  combos: readonly Record<string, string>[],
  optionNames: readonly string[],
  drafts: readonly DraftLike[],
): number[] {
  const names = optionNames.map(norm);
  const keyed = drafts.map((d) =>
    Object.fromEntries(Object.entries(d.options).map(([k, v]) => [norm(k), norm(v)])),
  );
  const combosKeyed = combos.map((c) =>
    Object.fromEntries(Object.entries(c).map(([k, v]) => [norm(k), norm(v)])),
  );
  const result = combos.map(() => -1);
  const used = new Set<number>();

  // 1. Exactas
  combosKeyed.forEach((combo, ci) => {
    const di = keyed.findIndex(
      (d, i) =>
        !used.has(i) &&
        Object.keys(d).length === names.length &&
        names.every((n) => d[n] === combo[n]),
    );
    if (di >= 0) {
      result[ci] = di;
      used.add(di);
    }
  });
  // 2. Compatibles con más coincidencias
  combosKeyed.forEach((combo, ci) => {
    if (result[ci] !== -1) return;
    let best = -1;
    let bestScore = -1;
    keyed.forEach((d, i) => {
      if (used.has(i)) return;
      const shared = Object.keys(d).filter((k) => names.includes(k));
      if (shared.some((k) => d[k] !== combo[k])) return;
      if (shared.length > bestScore) {
        best = i;
        bestScore = shared.length;
      }
    });
    if (best >= 0) {
      result[ci] = best;
      used.add(best);
    }
  });
  return result;
}

export function renameOptionKey<T extends DraftLike>(drafts: T[], from: string, to: string): T[] {
  if (!from.trim() || norm(from) === norm(to) || !to.trim()) {
    if (!from.trim() || !to.trim() || from === to) return drafts;
  }
  return drafts.map((d) => {
    const entry = Object.entries(d.options).find(([k]) => norm(k) === norm(from));
    if (!entry) return d;
    const { [entry[0]]: value, ...rest } = d.options;
    return { ...d, options: { ...rest, [to.trim()]: value! } };
  });
}

export function renameOptionValue<T extends DraftLike>(
  drafts: T[],
  option: string,
  from: string,
  to: string,
): T[] {
  if (!from || !to || from === to) return drafts;
  return drafts.map((d) => {
    const key = Object.keys(d.options).find((k) => norm(k) === norm(option));
    if (!key || norm(d.options[key]!) !== norm(from)) return d;
    return { ...d, options: { ...d.options, [key]: to } };
  });
}
