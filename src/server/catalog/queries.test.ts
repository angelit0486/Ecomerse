import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, parseSignature } from "./queries";

describe("cursor del listado", () => {
  it("ida y vuelta", () => {
    const cursor = {
      updated_at: "2026-10-06T00:00:00.000Z",
      id: "0190a0d0-0000-7000-8000-000000000001",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("ignora cursores manipulados", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("no-es-base64-json")).toBeUndefined();
    expect(
      decodeCursor(Buffer.from('{"updated_at":"x","id":"1"}').toString("base64url")),
    ).toBeUndefined();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ updated_at: "2026-10-06", id: "1; drop table" })).toString(
          "base64url",
        ),
      ),
    ).toBeUndefined();
    expect(decodeCursor("a".repeat(500))).toBeUndefined();
  });
});

describe("parseSignature", () => {
  it("convierte la firma de la variante en su selección", () => {
    expect(parseSignature("Color=Negro|Talla=M")).toEqual({ Color: "Negro", Talla: "M" });
    expect(parseSignature("")).toEqual({});
  });
});
