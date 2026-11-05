import { describe, expect, it } from "vitest";

import { MAX_IMPORT_BYTES } from "@/server/imports/products";

import { parseCsv } from "@/lib/csv-parse";

import { PasteError, PASTE_MAX_BYTES, parseTsv, pastedToCsv, rowsToCsv } from "./paste";
import { translatePlatformCsv } from "./platforms";

describe("filas pegadas desde Excel o Google Sheets", () => {
  it("el límite es el mismo que el del importador", () => {
    expect(PASTE_MAX_BYTES).toBe(MAX_IMPORT_BYTES);
  });

  it("separa por tabuladores, con CRLF o LF, y quita las filas vacías", () => {
    expect(parseTsv("Producto\tPrecio\r\nTaza\t199\n\n  \t \nPlato\t89\n")).toEqual([
      ["Producto", "Precio"],
      ["Taza", "199"],
      ["Plato", "89"],
    ]);
  });

  it("respeta las comillas: tabuladores, saltos de línea y comillas dentro de una celda", () => {
    const rows = parseTsv('Producto\tDescripción\n"Taza\tazul"\t"Línea 1\nLínea ""2"""\n');
    expect(rows).toEqual([
      ["Producto", "Descripción"],
      ["Taza\tazul", 'Línea 1\nLínea "2"'],
    ]);
  });

  it("celdas vacías al inicio y al final se conservan; una comilla suelta es texto", () => {
    expect(parseTsv('\tB\t\nx"y\t2\t3')).toEqual([
      ["", "B", ""],
      ['x"y', "2", "3"],
    ]);
  });

  it("comillas sin cerrar, demasiadas columnas o una celda enorme: error", () => {
    expect(() => parseTsv('a\t"b')).toThrowError(PasteError);
    expect(() => parseTsv(Array.from({ length: 101 }, () => "x").join("\t"))).toThrowError(
      PasteError,
    );
    expect(() => parseTsv(`a\t${"x".repeat(20_001)}`)).toThrowError(PasteError);
  });

  it("rowsToCsv cita lo necesario y lo lee de vuelta el lector CSV del importador", () => {
    const rows = [
      ["Producto", "Descripción"],
      ["Taza, azul", 'Dice "hola"\ny adiós'],
      ["=SUMA(1)", " con espacio "],
    ];
    const parsed = parseCsv(rowsToCsv(rows));
    // El lector del importador deja los encabezados en minúsculas.
    expect(parsed.headers).toEqual(["producto", "descripción"]);
    expect(parsed.rows).toEqual(rows.slice(1));
  });

  it("pastedToCsv convierte lo pegado y deja pasar un CSV pegado tal cual", () => {
    expect(pastedToCsv("Producto\tPrecio\nTaza\t199")).toBe("Producto,Precio\r\nTaza,199\r\n");
    expect(pastedToCsv("Producto,Precio\nTaza,199")).toBe("Producto,Precio\nTaza,199");
  });

  it("de la celda pegada a la hoja traducida: lo que se copia es lo que se importa", () => {
    const csv = pastedToCsv(
      "Producto\tPrecio\tExistencias\tCategoría\nTaza de barro\t$199.50\t10\tCocina, Regalos\nPlato hondo\t89\t\t",
    );
    const parsed = parseCsv(csv);
    const t = translatePlatformCsv(parsed.headers, parsed.rows, parsed.rowNumbers);
    expect(t.platform).toBe("hoja");
    expect(t.headers).toEqual(["handle", "title", "price", "inventory_quantity", "categories"]);
    expect(t.rows).toEqual([
      ["taza-de-barro", "Taza de barro", "199.50", "10", "Cocina|Regalos"],
      ["plato-hondo", "Plato hondo", "89", "", ""],
    ]);
  });
});
