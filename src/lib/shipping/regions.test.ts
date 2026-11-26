import { describe, expect, it } from "vitest";

import { MX_STATES } from "@/lib/checkout/mx-states";

import { isMexicoOnly, mxStateName, normalizeMxRegions } from "./regions";

describe("regiones de una zona de México", () => {
  it("acepta el nombre sin acentos ni mayúsculas y lo deja como lo usa el checkout", () => {
    expect(mxStateName("nuevo leon")).toBe("Nuevo León");
    expect(mxStateName("  QUERETARO ")).toBe("Querétaro");
    expect(mxStateName("Yucatán")).toBe("Yucatán");
  });

  it("entiende las abreviaturas comunes", () => {
    expect(mxStateName("CDMX")).toBe("Ciudad de México");
    expect(mxStateName("Edomex")).toBe("Estado de México");
    expect(mxStateName("Q. Roo")).toBe("Quintana Roo");
    expect(mxStateName("Veracruz de Ignacio de la Llave")).toBe("Veracruz");
  });

  it("los 32 estados se reconocen a sí mismos", () => {
    expect(MX_STATES.every((s) => mxStateName(s) === s)).toBe(true);
  });

  it("separa lo que no es un estado y no repite", () => {
    expect(normalizeMxRegions(["Jalisco", "jalisco", "Jalsico", "", "CDMX"])).toEqual({
      regions: ["Jalisco", "Ciudad de México"],
      unknown: ["Jalsico"],
    });
  });

  it("solo una zona de México usa la lista de estados", () => {
    expect(isMexicoOnly(["MX"])).toBe(true);
    expect(isMexicoOnly(["mx"])).toBe(true);
    expect(isMexicoOnly(["MX", "US"])).toBe(false);
    expect(isMexicoOnly([])).toBe(false);
  });
});
