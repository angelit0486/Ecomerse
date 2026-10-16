import { describe, expect, it } from "vitest";

import { leadTimeLabel } from "./lead-time";

describe("plazo de preparación del proveedor", () => {
  it("usa el plazo capturado", () => {
    expect(leadTimeLabel({ min: 2, max: 4 })).toBe("Se prepara en 2 a 4 días antes de enviarse");
    expect(leadTimeLabel({ min: 1, max: 1 })).toBe("Se prepara en 1 día antes de enviarse");
    expect(leadTimeLabel({ min: 0, max: 3 })).toBe("Se prepara en 0 a 3 días antes de enviarse");
  });

  it("sin dato o con datos imposibles no dice nada", () => {
    expect(leadTimeLabel(null)).toBeNull();
    expect(leadTimeLabel(undefined)).toBeNull();
    expect(leadTimeLabel({ min: 0, max: 0 })).toBeNull();
    expect(leadTimeLabel({ min: 5, max: 2 })).toBeNull();
    expect(leadTimeLabel({ min: -1, max: 2 })).toBeNull();
    expect(leadTimeLabel({ min: 1.5, max: 2 })).toBeNull();
  });
});
