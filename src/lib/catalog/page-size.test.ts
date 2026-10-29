import { describe, expect, it } from "vitest";

import { parsePageSize } from "./page-size";

describe("productos por página", () => {
  it("acepta 25, 50 y 100", () => {
    expect(parsePageSize("25")).toBe(25);
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("100")).toBe(100);
  });

  it("cualquier otro valor vuelve a 25 (la base no da más de 100)", () => {
    for (const v of [undefined, "", "0", "-5", "101", "1000", "abc", "50.5"]) {
      expect(parsePageSize(v)).toBe(25);
    }
  });
});
