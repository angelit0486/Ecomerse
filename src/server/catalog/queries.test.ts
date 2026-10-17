import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, parseSignature } from "./queries";

describe("cursor del listado", () => {
  const id = "0190a0d0-0000-7000-8000-000000000001";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it("ida y vuelta en cada orden", () => {
    const cases = [
      { s: "recientes", k: "2026-10-17 20:01:02.123456+00", id },
      { s: "nombre", k: "proteína whey", id },
      { s: "precio_asc", k: "89900", id },
      { s: "precio_desc", k: "0", id },
    ] as const;
    for (const cursor of cases) {
      expect(decodeCursor(encodeCursor(cursor), cursor.s)).toEqual(cursor);
    }
  });

  it("acepta el cursor de un título largo con acentos (más de 200 caracteres en la URL)", () => {
    const cursor = { s: "nombre", k: "proteína ".repeat(22).trim(), id } as const;
    const encoded = encodeCursor(cursor);
    expect(encoded.length).toBeGreaterThan(200);
    expect(decodeCursor(encoded, "nombre")).toEqual(cursor);
  });

  it("un cursor de otro orden se ignora (vuelve a la primera página)", () => {
    const cursor = encodeCursor({ s: "nombre", k: "a", id });
    expect(decodeCursor(cursor, "precio_asc")).toBeUndefined();
    expect(decodeCursor(cursor)).toBeUndefined();
  });

  it("ignora cursores manipulados", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("no-es-base64-json")).toBeUndefined();
    expect(decodeCursor(encode({ s: "recientes", k: "x", id }))).toBeUndefined();
    expect(decodeCursor(encode({ s: "precio_asc", k: "-5", id }), "precio_asc")).toBeUndefined();
    expect(
      decodeCursor(encode({ s: "nombre", k: "a", id: "1; drop table" }), "nombre"),
    ).toBeUndefined();
    // El formato anterior (antes de ordenar) ya no se acepta.
    expect(decodeCursor(encode({ updated_at: "2026-10-06T00:00:00.000Z", id }))).toBeUndefined();
    expect(decodeCursor("a".repeat(700))).toBeUndefined();
  });
});

describe("parseSignature", () => {
  it("convierte la firma de la variante en su selección", () => {
    expect(parseSignature("Color=Negro|Talla=M")).toEqual({ Color: "Negro", Talla: "M" });
    expect(parseSignature("")).toEqual({});
  });
});
