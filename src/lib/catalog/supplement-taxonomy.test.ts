import { describe, expect, it } from "vitest";

import {
  SUPPLEMENT_CATEGORIES,
  missingSupplementCategories,
  normalizeName,
} from "./supplement-taxonomy";

describe("estructura sugerida de suplementos", () => {
  it("son las 8 categorías pedidas, con direcciones válidas y únicas", () => {
    expect(SUPPLEMENT_CATEGORIES.map((c) => c.name)).toEqual([
      "Proteínas",
      "Preentrenos y energía",
      "Creatina",
      "Aminoácidos",
      "Vitaminas y minerales",
      "Salud y bienestar",
      "Ganadores de masa",
      "Accesorios deportivos",
    ]);
    const slugs = SUPPLEMENT_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("normaliza acentos, mayúsculas y espacios", () => {
    expect(normalizeName("  PROTEÍNAS ")).toBe("proteinas");
    expect(normalizeName("Vitaminas   y Minerales")).toBe("vitaminas y minerales");
  });

  it("omite las que ya existen en el primer nivel por dirección o por nombre", () => {
    const missing = missingSupplementCategories([
      { name: "Mis proteínas", slug: "proteinas", depth: 0 },
      { name: "CREATINA", slug: "creatina-monohidratada", depth: 0 },
      // Una subcategoría con el mismo nombre no cuenta: la sugerida es de primer nivel.
      { name: "Aminoácidos", slug: "aminoacidos", depth: 1 },
    ]);
    expect(missing.map((c) => c.slug)).toEqual([
      "preentrenos-y-energia",
      "aminoacidos",
      "vitaminas-y-minerales",
      "salud-y-bienestar",
      "ganadores-de-masa",
      "accesorios-deportivos",
    ]);
    expect(missingSupplementCategories([])).toHaveLength(8);
  });
});
