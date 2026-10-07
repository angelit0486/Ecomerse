/**
 * Lector CSV (RFC 4180) para importaciones (GATE0 §26.1): BOM UTF-8, separador
 * `,` o `;` (el que aparezca fuera de comillas en el encabezado), comillas
 * dobles con "" escapadas, saltos de línea dentro de comillas y CRLF/LF.
 * Sin dependencias: el archivo ya viene limitado en tamaño.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: "," | ";";
}

export class CsvParseError extends Error {
  constructor(
    readonly line: number,
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

export function parseCsv(input: string): ParsedCsv {
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
      }
      continue;
    }
    if (ch === '"') {
      if (field.length > 0)
        throw new CsvParseError(line, "comilla dentro de un campo sin comillas");
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
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
  }
  if (inQuotes) throw new CsvParseError(line, "comillas sin cerrar");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Las filas totalmente vacías (p. ej. al final del archivo) no cuentan.
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim().toLowerCase()), rows, delimiter };
}
