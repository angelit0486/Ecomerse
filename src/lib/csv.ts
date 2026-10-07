/**
 * CSV (RFC 4180) para exportaciones (GATE0 §26.2). Comillas siempre que hagan
 * falta, saltos de línea CRLF y BOM UTF-8 para que Excel lea los acentos.
 *
 * Protección contra formula injection: una celda de TEXTO que empieza con
 * = + - @ tabulador o retorno se prefija con ' para que la hoja de cálculo no la
 * ejecute. Los números que genera la plataforma se escriben tal cual.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : "";
  } else if (typeof value === "boolean") {
    text = value ? "sí" : "no";
  } else {
    text = FORMULA_START.test(value) ? `'${value}` : value;
  }
  return /[",\r\n;]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
