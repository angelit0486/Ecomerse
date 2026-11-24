import { describe, expect, it } from "vitest";

import { clabeFrom, groupClabe, isValidClabe } from "./clabe";

describe("CLABE en las instrucciones de pago", () => {
  it("valida el dígito de control", () => {
    expect(isValidClabe("167041000088400281")).toBe(true);
    expect(isValidClabe("127180016266035460")).toBe(true);
    expect(isValidClabe("167041000088400282")).toBe(false);
    expect(isValidClabe("16704100008840028")).toBe(false);
  });

  it("la encuentra en el texto de la tienda, con o sin espacios", () => {
    const text =
      "Transferencia SPEI\nCLABE: 167041000088400281\nBeneficiario: Alien Demon\nConcepto: el número de tu pedido";
    expect(clabeFrom(text)).toBe("167041000088400281");
    expect(clabeFrom("CLABE 1271 8001 6266 0354 60")).toBe("127180016266035460");
    expect(clabeFrom("CLABE 127-180-01626603546-0")).toBe("127180016266035460");
  });

  it("no ofrece números que no son una CLABE válida", () => {
    expect(clabeFrom("Llámanos al 55 1234 5678")).toBeNull();
    expect(clabeFrom("Cuenta 167041000088400282")).toBeNull();
    expect(clabeFrom("")).toBeNull();
    expect(clabeFrom(null)).toBeNull();
  });

  it("la agrupa de 4 en 4 para leerla", () => {
    expect(groupClabe("167041000088400281")).toBe("1670 4100 0088 4002 81");
  });
});
