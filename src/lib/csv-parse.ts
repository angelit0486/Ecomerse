/**
 * Lector CSV (RFC 4180) para importaciones (GATE0 §26.1): BOM UTF-8, separador
 * `,` o `;` (el que aparezca fuera de comillas en el encabezado), comillas
 * dobles con "" escapadas, saltos de línea dentro de comillas y CRLF/LF.
 * Sin dependencias: el archivo ya viene limitado en tamaño.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Número de fila de la hoja de cálculo de cada fila (las vacías también cuentan). */
  rowNumbers: number[];
  delimiter: "," | ";";
}

export interface CsvLimits {
  /** Columnas por fila (un encabezado con miles de comas no se procesa). */
  maxColumns?: number;
  /** Caracteres por celda. */
  maxFieldLength?: number;
}

export type CsvErrorCode = "quote" | "unclosed" | "columns" | "field";

export class CsvParseError extends Error {
  constructor(
    readonly line: number,
    readonly code: CsvErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CsvParseError";
  }
}

function detectDelimiter(text: string): "," | ";" {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch === ",") commas += 1;
    else if (!inQuotes && ch === ";") semis += 1;
  }
  return semis > commas ? ";" : ",";
}

export function parseCsv(input: string, limits: CsvLimits = {}): ParsedCsv {
  const maxColumns = limits.maxColumns ?? 100;
  const maxField = limits.maxFieldLength ?? 20_000;
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
        if (field.length > maxField) {
          throw new CsvParseError(line, "field", `una celda tiene más de ${maxField} caracteres`);
        }
      }
      continue;
    }
    if (ch === '"') {
      if (field.length > 0)
        throw new CsvParseError(line, "quote", "comilla dentro de un campo sin comillas");
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
      if (record.length >= maxColumns) {
        throw new CsvParseError(line, "columns", `más de ${maxColumns} columnas`);
      }
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      line += 1;
    } else {
      field += ch;
    }
    if (field.length > maxField)
      throw new CsvParseError(line, "field", `una celda tiene más de ${maxField} caracteres`);
  }
  if (inQuotes) throw new CsvParseError(line, "unclosed", "comillas sin cerrar");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Las filas totalmente vacías no se procesan, pero cuentan para numerar como la
  // hoja de cálculo (cada registro CSV es una fila de la hoja).
  const numbered = records
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => r.some((c) => c.trim() !== ""));
  const [header, ...rest] = numbered;
  return {
    headers: (header?.r ?? []).map((h) => h.trim().toLowerCase()),
    rows: rest.map(({ r }) => r),
    rowNumbers: rest.map(({ n }) => n),
    delimiter,
  };
}
