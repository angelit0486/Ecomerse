import { describe, expect, it } from "vitest";

import { planProductImport } from "@/server/imports/products";

import { detectPlatform, translatePlatformCsv } from "./platforms";
import { SHEET_TEMPLATES, sheetTemplate } from "./sheet-templates";

describe("hojas de inicio por giro", () => {
  it("cubren los cuatro giros iniciales, sin claves repetidas", () => {
    expect(SHEET_TEMPLATES.map((t) => t.key)).toEqual([
      "ropa",
      "hogar",
      "abarrotes",
      "suplementos",
    ]);
    expect(sheetTemplate("ropa")?.headers).toContain("Talla");
    expect(sheetTemplate("otro")).toBeUndefined();
    expect(sheetTemplate(null)).toBeUndefined();
  });

  it.each(SHEET_TEMPLATES)("$key: la tienda entiende todas sus columnas", (template) => {
    expect(detectPlatform(template.headers)).toBe("hoja");
    expect(new Set(template.headers).size).toBe(template.headers.length);
    const values: Record<string, string> = {
      Producto: "Artículo de prueba",
      Precio: "100",
      "Precio anterior": "150",
      Costo: "60",
    };
    const row = template.headers.map((h) => values[h] ?? "");
    const t = translatePlatformCsv(template.headers, [row], [2]);
    expect(t.ignored).toEqual([]);
    const [planned] = planProductImport(t.headers, t.rows, t.rowNumbers);
    expect(planned!.errors).toEqual([]);
  });
});
