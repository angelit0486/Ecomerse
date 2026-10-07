import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("entrecomilla comas, comillas, saltos de línea y espacios de borde", () => {
    expect(csvCell('Taza "grande", azul')).toBe('"Taza ""grande"", azul"');
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvCell(" espacio")).toBe('" espacio"');
    expect(csvCell("normal")).toBe("normal");
  });

  it("neutraliza fórmulas en celdas de texto (formula injection)", () => {
    for (const evil of ['=HYPERLINK("http://x")', "+1+1", "-2", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });

  it("los números de la plataforma no se alteran (incluidos los negativos)", () => {
    expect(csvCell(-1500)).toBe("-1500");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("vacíos y booleanos", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("sí");
  });

  it("documento con BOM y CRLF", () => {
    expect(toCsv(["a", "b"], [["1", 2]])).toBe("﻿a,b\r\n1,2\r\n");
  });
});
