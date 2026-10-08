import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";
import { CsvParseError, parseCsv } from "./csv-parse";

describe("parseCsv", () => {
  it("BOM, comas, comillas escapadas y saltos de línea dentro de comillas", () => {
    const p = parseCsv(
      '﻿handle,title\r\ntaza,"Taza ""grande"", azul"\r\nvela,"línea 1\nlínea 2"\r\n',
    );
    expect(p.headers).toEqual(["handle", "title"]);
    expect(p.rows).toEqual([
      ["taza", 'Taza "grande", azul'],
      ["vela", "línea 1\nlínea 2"],
    ]);
  });

  it("detecta punto y coma (Excel en español)", () => {
    const p = parseCsv("handle;price\ntaza;199,50\n");
    expect(p.delimiter).toBe(";");
    expect(p.rows).toEqual([["taza", "199,50"]]);
  });

  it("ignora filas vacías y normaliza encabezados", () => {
    expect(parseCsv(" Handle , TITLE \n\n a,b\n,\n").headers).toEqual(["handle", "title"]);
    expect(parseCsv("a,b\n\n1,2\n , \n").rows).toEqual([["1", "2"]]);
  });

  it("ida y vuelta con el escritor de exportaciones", () => {
    const csv = toCsv(["a", "b"], [["=SUMA(A1)", 'x,"y"\nz']]);
    expect(parseCsv(csv).rows).toEqual([["'=SUMA(A1)", 'x,"y"\nz']]);
  });

  it("numera las filas como la hoja de cálculo, contando las vacías", () => {
    const p = parseCsv("handle,price\na,1\n,\n\nb,2\n");
    expect(p.rows).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(p.rowNumbers).toEqual([2, 5]);
  });

  it("límites: columnas por fila y caracteres por celda", () => {
    expect(() => parseCsv(`handle${",".repeat(100)}\n`)).toThrow(/más de 100 columnas/);
    expect(parseCsv(`handle${",".repeat(99)}\n`).headers).toHaveLength(100);
    expect(() => parseCsv(`a\n"${"x".repeat(20_001)}"\n`)).toThrow(/más de 20000 caracteres/);
    expect(() => parseCsv(`a\n${"x".repeat(50)}\n`, { maxFieldLength: 10 })).toThrow(CsvParseError);
  });

  it("errores de formato con número de línea", () => {
    expect(() => parseCsv('a,b\n1,"abierta\n')).toThrow(CsvParseError);
    expect(() => parseCsv('a,b\n1,x"y\n')).toThrow(/comilla/);
  });
});
