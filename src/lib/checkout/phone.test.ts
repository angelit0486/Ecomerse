import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone";

// La misma regla que la base (checkout_tables: addresses.phone, calculate_cart).
const DB_PHONE = /^\+?[0-9 ()-]{7,20}$/;

describe("teléfono de la dirección: formatos comunes en México", () => {
  it.each([
    ["222.123.4567", "222 123 4567"],
    ["222/123/4567", "222 123 4567"],
    ["+52 222 123 4567", "+52 222 123 4567"],
    ["(222) 123–4567", "(222) 123-4567"],
    ["222 123 4567", "222 123 4567"],
    ["  2221234567  ", "2221234567"],
    ["+52 1 (222) 123-4567 ext. 12", "+52 1 (222) 123-4567"],
  ])("«%s» se guarda como «%s» y la base lo acepta", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(DB_PHONE.test(normalizePhone(input))).toBe(true);
  });

  it("vacío sigue vacío (el campo obligatorio lo marca el formulario)", () => {
    expect(normalizePhone("   ")).toBe("");
  });

  it("no inventa dígitos: letras sueltas se quitan y lo demás queda como está", () => {
    expect(normalizePhone("tel 222 123 4567")).toBe("222 123 4567");
  });
});
