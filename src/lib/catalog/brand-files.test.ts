import { describe, expect, it } from "vitest";

import { brandKey, matchBrandFile } from "./brand-files";

const brands = [
  { id: "1", name: "Muha Meds", slug: "muha-meds" },
  { id: "2", name: "Óptimum Nutrición", slug: "optimum-nutricion" },
  { id: "3", name: "Ace Ultra", slug: "ace-ultra" },
  { id: "4", name: "Ace", slug: "ace" },
];

describe("brandKey", () => {
  it("quita extensión, acentos, separadores y palabras de relleno", () => {
    expect(brandKey("Muha_Meds-LOGO.png")).toBe("muhameds");
    expect(brandKey("óptimum nutrición final (2).webp")).toBe("optimumnutricion");
    expect(brandKey("logo.png")).toBe("");
  });
});

describe("matchBrandFile", () => {
  it("asigna por nombre o por slug", () => {
    expect(matchBrandFile("muha-meds-logo.png", brands)?.id).toBe("1");
    expect(matchBrandFile("OPTIMUM NUTRICION.jpg", brands)?.id).toBe("2");
    expect(matchBrandFile("ace-ultra.png", brands)?.id).toBe("3");
    expect(matchBrandFile("ace.png", brands)?.id).toBe("4");
  });

  it("sin coincidencia (o con un nombre vacío) no asigna nada", () => {
    expect(matchBrandFile("besos.png", brands)).toBeNull();
    expect(matchBrandFile("logo.png", brands)).toBeNull();
  });
});
