import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { deriveKey, open, parseKey, seal } from "./secret-box";

const key = randomBytes(32);

describe("secret-box", () => {
  it("cifra y descifra con el mismo contexto", () => {
    const box = seal(key, "APP_USR-123-secreto", "cuenta-a");
    expect(box).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(box).not.toContain("secreto");
    expect(open(key, box, "cuenta-a")).toBe("APP_USR-123-secreto");
  });

  it("cada sobre es distinto aunque el texto sea igual", () => {
    expect(seal(key, "x", "c")).not.toBe(seal(key, "x", "c"));
  });

  it("un sobre de otra cuenta, alterado o con otra clave no se abre", () => {
    const box = seal(key, "llave", "cuenta-a");
    expect(() => open(key, box, "cuenta-b")).toThrow();
    expect(() => open(randomBytes(32), box, "cuenta-a")).toThrow();
    const parts = box.split(".");
    parts[3] = Buffer.from("otra cosa").toString("base64url");
    expect(() => open(key, parts.join("."), "cuenta-a")).toThrow();
    expect(() => open(key, "v2.a.b.c", "cuenta-a")).toThrow();
  });

  it("exige una clave de 32 bytes", () => {
    expect(parseKey(key.toString("base64"))).toHaveLength(32);
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });

  it("las subclaves dependen del propósito", () => {
    expect(deriveKey(key, "a").equals(deriveKey(key, "b"))).toBe(false);
  });
});
