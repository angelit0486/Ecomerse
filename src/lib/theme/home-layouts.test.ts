import { describe, expect, it } from "vitest";

import { buildHomeLayout, HOME_LAYOUTS } from "./home-layouts";
import { HomeSectionsV2 } from "./schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = () => {
  let n = 100;
  return () => uuid(n++);
};
const BRANDS = [uuid(1), uuid(2), uuid(3)];
const GOALS = [uuid(4)];

describe("plantillas de portada del editor", () => {
  for (const layout of HOME_LAYOUTS) {
    it(`«${layout.name}» es una portada válida, con o sin marcas y objetivos`, () => {
      for (const ctx of [
        { storeName: "PRUVA", brandIds: BRANDS, goalIds: GOALS },
        { storeName: "", brandIds: [BRANDS[0]!], goalIds: [] },
      ]) {
        const sections = buildHomeLayout(layout.key, ctx, ids());
        expect(HomeSectionsV2.safeParse(sections).success).toBe(true);
        expect(sections[0]!.type).toBe("hero");
        expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
      }
    });
  }

  it("«Anaquel» agrega «Nuestras marcas» solo con 2 o más marcas con logo", () => {
    const types = (brandIds: string[]) =>
      buildHomeLayout("anaquel", { storeName: "x", brandIds, goalIds: GOALS }, ids()).map(
        (s) => s.type,
      );
    expect(types(BRANDS)).toContain("brand_logos");
    expect(types([BRANDS[0]!])).not.toContain("brand_logos");
    expect(types(BRANDS)).toContain("goals");
  });

  it("«En blanco» usa el nombre de la tienda", () => {
    const [hero] = buildHomeLayout(
      "blanco",
      { storeName: "Tienda Sol", brandIds: [], goalIds: [] },
      ids(),
    );
    expect(hero!.props).toEqual({ heading: "Tienda Sol", align: "center" });
  });
});
