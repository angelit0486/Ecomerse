import { describe, expect, it } from "vitest";

import { normalizeSupplementSheet, SUPPLEMENT_TEXT_LIMITS } from "./regulatory";

describe("normalizeSupplementSheet (espejo de app.regulatory_normalize)", () => {
  it("recorta, quita vacíos y renglones vacíos", () => {
    expect(
      normalizeSupplementSheet({
        form: "  Cápsulas  ",
        ingredients: "Aceite de pescado",
        usage: "",
        servings_per_container: 60,
        nutrition: [
          { name: "Omega 3", amount: "1000", unit: "mg" },
          { name: "", amount: "" },
        ],
      }),
    ).toEqual({
      ok: true,
      sheet: {
        form: "Cápsulas",
        ingredients: "Aceite de pescado",
        servings_per_container: 60,
        nutrition: [{ name: "Omega 3", amount: "1000", unit: "mg" }],
      },
    });
  });

  it("contenido neto (Fase A): hasta 100 caracteres, como en la base", () => {
    expect(normalizeSupplementSheet({ net_content: " 907 g " })).toEqual({
      ok: true,
      sheet: { net_content: "907 g" },
    });
    expect(normalizeSupplementSheet({ net_content: "x".repeat(101) })).toEqual({
      ok: false,
      fields: ["net_content"],
    });
  });

  it("rechaza campos fuera de la lista blanca, límites y caracteres de control", () => {
    expect(normalizeSupplementSheet({ ingredients: "x", potencia: "ultra" })).toEqual({
      ok: false,
      fields: ["data"],
    });
    expect(
      normalizeSupplementSheet({
        ingredients: "x".repeat(SUPPLEMENT_TEXT_LIMITS.ingredients + 1),
        servings_per_container: 0,
      }),
    ).toMatchObject({ ok: false, fields: ["ingredients", "servings_per_container"] });
    expect(normalizeSupplementSheet({ warnings: "texto\u0007" })).toEqual({
      ok: false,
      fields: ["warnings"],
    });
    // Los saltos de línea sí se permiten en los textos largos.
    expect(normalizeSupplementSheet({ warnings: "Línea 1\nLínea 2" })).toMatchObject({ ok: true });
  });

  it("un renglón nutrimental con algo escrito necesita nombre y cantidad", () => {
    expect(normalizeSupplementSheet({ nutrition: [{ name: "Omega 3" }] })).toEqual({
      ok: false,
      fields: ["nutrition"],
    });
    expect(normalizeSupplementSheet({ nutrition: [{ amount: "10", unit: "mg" }] })).toEqual({
      ok: false,
      fields: ["nutrition"],
    });
  });

  it("la tabla nutrimental no lleva «|» ni «;» (separan celdas y renglones en el CSV)", () => {
    expect(
      normalizeSupplementSheet({ nutrition: [{ name: "Omega 3|EPA", amount: "1000" }] }),
    ).toEqual({ ok: false, fields: ["nutrition"] });
    expect(
      normalizeSupplementSheet({ nutrition: [{ name: "Omega 3", amount: "1000", unit: "mg;" }] }),
    ).toEqual({ ok: false, fields: ["nutrition"] });
    expect(normalizeSupplementSheet({ ingredients: "Aceite; gelatina | glicerina" })).toMatchObject(
      {
        ok: true,
      },
    );
  });
});
