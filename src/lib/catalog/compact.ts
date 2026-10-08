/**
 * Formatos compactos de una celda del CSV de productos (R-T05):
 *
 * - Tabla nutrimental: un renglón por nutrimento separado por `;`, y en cada uno
 *   `nombre|cantidad|unidad|%VNR` (unidad y %VNR opcionales):
 *   `Omega 3|1000|mg; EPA|180|mg|10%`.
 * - Atributos: `clave:valor|valor; clave:valor` con las claves de la URL:
 *   `objetivo:energia|fuerza; sabor:chocolate`.
 *
 * La exportación usa `format*` y la importación `parse*`: lo exportado se vuelve
 * a importar igual. Por eso `|` y `;` no se permiten dentro de la tabla
 * nutrimental (la base también los rechaza).
 */

export interface NutritionCells {
  name: string;
  amount: string;
  unit?: string;
  dv?: string;
}

export type CompactResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ATTRIBUTE_KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function formatNutrition(rows: readonly NutritionCells[]): string {
  return rows
    .map((row) => {
      const cells = [row.name, row.amount, row.unit ?? "", row.dv ?? ""];
      while (cells.length > 2 && cells.at(-1) === "") cells.pop();
      return cells.join("|");
    })
    .join("; ");
}

export function parseNutrition(text: string): CompactResult<NutritionCells[]> {
  const rows: NutritionCells[] = [];
  for (const [i, segment] of text.split(";").entries()) {
    const raw = segment.trim();
    if (!raw) continue;
    const cells = raw.split("|").map((c) => c.trim());
    if (cells.length > 4) {
      return { ok: false, error: `Renglón ${i + 1}: usa nombre|cantidad|unidad|%VNR.` };
    }
    const [name = "", amount = "", unit = "", dv = ""] = cells;
    if (!name || !amount) {
      return { ok: false, error: `Renglón ${i + 1}: falta el nombre o la cantidad.` };
    }
    rows.push({ name, amount, ...(unit ? { unit } : {}), ...(dv ? { dv } : {}) });
  }
  return { ok: true, value: rows };
}

export function formatAttributes(attributes: readonly { key: string; values: string[] }[]): string {
  return attributes
    .filter((a) => a.values.length > 0)
    .map((a) => `${a.key}:${a.values.join("|")}`)
    .join("; ");
}

export function parseAttributes(text: string): CompactResult<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const segment of text.split(";")) {
    const raw = segment.trim();
    if (!raw) continue;
    const colon = raw.indexOf(":");
    const key = colon === -1 ? "" : raw.slice(0, colon).trim();
    const values =
      colon === -1
        ? []
        : raw
            .slice(colon + 1)
            .split("|")
            .map((v) => v.trim());
    if (
      !ATTRIBUTE_KEY_RE.test(key) ||
      values.length === 0 ||
      values.some((v) => !SLUG_RE.test(v))
    ) {
      return { ok: false, error: `«${raw}»: usa clave:valor|valor con las claves del atributo.` };
    }
    if (Object.hasOwn(out, key)) return { ok: false, error: `El atributo «${key}» está repetido.` };
    out[key] = [...new Set(values)];
  }
  return { ok: true, value: out };
}
