import { describe, expect, it } from "vitest";

import { COPY_PARTS, structureCopiedMessage } from "./copy-structure";

describe("copiar la estructura de otra tienda", () => {
  it("las partes coinciden con las que acepta la base", () => {
    expect(COPY_PARTS.map((p) => p.key)).toEqual(["categories", "pages", "policies", "menus"]);
  });

  it("el aviso dice qué se copió y que lo nuevo queda en borrador", () => {
    expect(
      structureCopiedMessage({ categories: 2, pages: 1, policies: 1, menu_items: 3, skipped: 1 }),
    ).toBe(
      "Copiamos 2 categorías, 1 página, 1 política y 3 entradas del menú. Las páginas y políticas quedan en borrador para que las revises. 1 elemento no se copió porque depende de productos o marcas de la otra tienda.",
    );
  });

  it("sin nada nuevo lo dice claro", () => {
    expect(
      structureCopiedMessage({ categories: 0, pages: 0, policies: 0, menu_items: 0, skipped: 0 }),
    ).toBe("No había nada nuevo que copiar: esta tienda ya tiene todo eso.");
  });
});
