import { describe, expect, it } from "vitest";

import { normalizeAttributeForm, parseAttributeParams, selectionPairs } from "./attributes";

describe("parseAttributeParams", () => {
  it("toma los filtros con forma de atributo y deja fuera los del listado", () => {
    expect(
      parseAttributeParams({
        objetivo: ["fuerza", "energia", "energia"],
        sabor: "chocolate",
        orden: "price_asc",
        q: "proteina",
        fbclid: "IwAR3_x",
        Talla: "m",
        "1x": "a",
        vacio: "",
      }),
    ).toEqual({ objetivo: ["energia", "fuerza"], sabor: ["chocolate"] });
  });

  it("limita a 10 atributos y 20 valores", () => {
    const params = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`a${String(i).padStart(2, "0")}`, "x"]),
    );
    expect(Object.keys(parseAttributeParams(params))).toHaveLength(10);
    const many = Array.from({ length: 25 }, (_, i) => `v${String(i).padStart(2, "0")}`);
    expect(parseAttributeParams({ objetivo: many }).objetivo).toHaveLength(20);
  });

  it("da los pares para enlaces y formularios", () => {
    expect(selectionPairs({ objetivo: ["energia", "fuerza"], sabor: ["chocolate"] })).toEqual([
      ["objetivo", "energia"],
      ["objetivo", "fuerza"],
      ["sabor", "chocolate"],
    ]);
  });
});

describe("normalizeAttributeForm", () => {
  const base = { id: "", name: " Objetivo ", filterable: true };

  it("recorta, ignora renglones nuevos vacíos y conserva los ids", () => {
    expect(
      normalizeAttributeForm({
        ...base,
        values: [
          { id: "", label: " Energía " },
          { id: "", label: "" },
          { id: "6b0c1a7e-1f3f-4c84-9a7e-2a4f3f0d9c11", label: "Fuerza" },
        ],
      }),
    ).toEqual({
      ok: true,
      attribute: {
        name: "Objetivo",
        is_filterable: true,
        values: [
          { label: "Energía" },
          { id: "6b0c1a7e-1f3f-4c84-9a7e-2a4f3f0d9c11", label: "Fuerza" },
        ],
      },
    });
  });

  it("marca nombres vacíos, repetidos o sin letras", () => {
    expect(normalizeAttributeForm({ ...base, name: "", values: [{ id: "", label: "A" }] })).toEqual(
      {
        ok: false,
        fields: { name: "Escribe un nombre de hasta 60 caracteres." },
      },
    );
    expect(
      normalizeAttributeForm({
        ...base,
        values: [
          { id: "", label: "Energía" },
          { id: "", label: "energía" },
        ],
      }),
    ).toEqual({ ok: false, fields: { values: "«energía» está repetido." } });
    expect(normalizeAttributeForm({ ...base, values: [{ id: "", label: "¡!" }] }).ok).toBe(false);
    expect(normalizeAttributeForm({ ...base, values: [] })).toEqual({
      ok: false,
      fields: { values: "Agrega entre 1 y 50 valores." },
    });
  });

  it("un valor existente sin nombre es un error, no un borrado", () => {
    expect(
      normalizeAttributeForm({
        ...base,
        values: [{ id: "6b0c1a7e-1f3f-4c84-9a7e-2a4f3f0d9c11", label: " " }],
      }).ok,
    ).toBe(false);
  });
});
