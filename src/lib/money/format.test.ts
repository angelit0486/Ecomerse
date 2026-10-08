import { describe, expect, it } from "vitest";

import { centsToInput, formatMoney, parseMoneyToCents } from "./format";

describe("dinero en centavos", () => {
  it("convierte el texto del usuario a centavos sin float", () => {
    expect(parseMoneyToCents("199")).toBe(19900);
    expect(parseMoneyToCents("199.5")).toBe(19950);
    expect(parseMoneyToCents("0.29")).toBe(29); // 0.29 * 100 en float daría 28.999…
    expect(parseMoneyToCents("1,299.90")).toBe(129990);
    expect(parseMoneyToCents("$ 10.10")).toBe(1010);
  });

  it("rechaza formatos ambiguos o inválidos", () => {
    for (const bad of ["", "abc", "1.999", "-5", "1,29", "12,34.5", "1e3", "99999999999999999"]) {
      expect(parseMoneyToCents(bad)).toBeNull();
    }
  });

  it("formatea para inputs y para mostrar", () => {
    expect(centsToInput(19900)).toBe("199.00");
    expect(centsToInput(5)).toBe("0.05");
    expect(centsToInput(null)).toBe("");
    expect(formatMoney(129990, "MXN")).toBe("$1,299.90");
  });

  it("negativos exactos (ventas netas con más reembolsos que ventas)", () => {
    expect(centsToInput(-150)).toBe("-1.50");
    expect(centsToInput(-5)).toBe("-0.05");
    expect(formatMoney(-150, "MXN")).toBe("-$1.50");
    expect(formatMoney(-129990, "MXN")).toBe("-$1,299.90");
  });
});
