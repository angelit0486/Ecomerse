/**
 * Filas pegadas desde Excel o Google Sheets (plan 2026-11-05, fase C). Al copiar
 * celdas, la hoja entrega texto separado por tabuladores (con comillas en las
 * celdas que llevan saltos de línea o comillas). Aquí se convierte a CSV, el
 * mismo formato que entiende el importador, para pasar por su misma validación:
 * no hay un camino nuevo hacia la base.
 */

/** Igual que el límite del importador (`MAX_IMPORT_BYTES`); una prueba los compara. */
export const PASTE_MAX_BYTES = 4 * 1024 * 1024;
export const PASTE_MAX_COLUMNS = 100;
export const PASTE_MAX_FIELD = 20_000;

export class PasteError extends Error {
  constructor(readonly code: "columns" | "field" | "quote") {
    super(code);
    this.name = "PasteError";
  }
}

/**
 * ¿La comilla en `start` abre una celda entre comillas? Solo si se cierra con una
 * comilla seguida de tabulador, salto de línea o el final. Google Sheets no
 * entrecomilla «"Edición" especial» (solo las celdas con saltos de línea): esa
 * celda es texto tal cual y no debe tragarse las columnas siguientes.
 */
function opensQuotedCell(text: string, start: number): boolean {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    if (text[i + 1] === '"') {
      i += 1;
      continue;
    }
    const next = text[i + 1];
    return next === undefined || next === "\t" || next === "\n" || next === "\r";
  }
  return false;
}

/** Texto separado por tabuladores → filas. Quita las filas totalmente vacías. */
export function parseTsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false; // ¿ya hay algo en la celda actual? (distingue «""» de celda vacía)

  const endField = () => {
    if (field.length > PASTE_MAX_FIELD) throw new PasteError("field");
    row.push(field);
    field = "";
    started = false;
    if (row.length > PASTE_MAX_COLUMNS) throw new PasteError("columns");
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !started && opensQuotedCell(text, i)) {
      quoted = true;
      started = true;
    } else if (ch === "\t") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      // Una comilla en medio de una celda sin comillas es texto.
      field += ch;
      started = true;
    }
  }
  if (quoted) throw new PasteError("quote");
  if (field !== "" || row.length > 0 || started) endRow();
  return rows;
}

function cell(value: string): string {
  return /[",\r\n;]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Filas → CSV (CRLF). Sin neutralizar fórmulas: es un dato que entra, no una hoja que sale. */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Lo pegado como CSV listo para el importador. Con tabuladores en el
 * encabezado se convierte; si no hay (alguien pegó un CSV), se devuelve tal cual.
 */
export function pastedToCsv(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("\t") ? rowsToCsv(parseTsv(text)) : text;
}
