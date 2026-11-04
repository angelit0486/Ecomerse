import { describe, expect, it } from "vitest";

import { STORE_FEATURES, visibleFeatures } from "./store-features";

describe("Ajustes → Funciones", () => {
  it("muestra solo las que la base permite y tienen texto, en orden fijo", () => {
    const rows = [
      { key: "mobile_input_size", enabled: true, locked: false },
      { key: "hero_image_carousel", enabled: false, locked: false },
      { key: "clave_sin_texto", enabled: true, locked: false },
    ];
    expect(visibleFeatures(rows).map((f) => [f.key, f.enabled])).toEqual([
      ["hero_image_carousel", false],
      ["mobile_input_size", true],
    ]);
  });

  it("cada función explica qué hace y dónde se nota", () => {
    for (const copy of Object.values(STORE_FEATURES)) {
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.description.length).toBeGreaterThan(20);
      expect(copy.where.length).toBeGreaterThan(3);
    }
  });
});
