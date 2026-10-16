import { describe, expect, it } from "vitest";

import { leadTimeLabel } from "./labels";

describe("leadTimeLabel", () => {
  it("rango, valor único, solo máximo, solo mínimo y sin dato", () => {
    expect(leadTimeLabel(2, 4)).toBe("2 a 4 días");
    expect(leadTimeLabel(3, 3)).toBe("3 días");
    expect(leadTimeLabel(1, 1)).toBe("1 día");
    expect(leadTimeLabel(null, 5)).toBe("Hasta 5 días");
    expect(leadTimeLabel(1, null)).toBe("Desde 1 día");
    expect(leadTimeLabel(null, null)).toBeNull();
  });
});
