import { describe, expect, it } from "vitest";

import { redact, redactString } from "./redact";

describe("redact", () => {
  it("redacta claves sensibles a cualquier profundidad", () => {
    const out = redact({
      user: { email: "a@b.com", password: "x", nested: { authorization: "Bearer t" } },
      store_id: "abc",
      apiKey: "k",
      customer_phone: "555",
      shipping_address: { line1: "Calle 1" },
    }) as Record<string, unknown>;
    expect(out).toEqual({
      user: {
        email: "[redactado]",
        password: "[redactado]",
        nested: { authorization: "[redactado]" },
      },
      store_id: "abc",
      apiKey: "[redactado]",
      customer_phone: "[redactado]",
      shipping_address: "[redactado]",
    });
  });

  it("enmascara emails, tokens Bearer, JWT y credenciales en URLs dentro de textos", () => {
    const text =
      "fallo para ana@example.com con Bearer abc.def-123 jwt eyJhbGciOi.eyJzdWIi.c2ln postgres://worker:s3cr3t@db:5432/x";
    const out = redactString(text);
    expect(out).not.toContain("ana@example.com");
    expect(out).not.toContain("abc.def-123");
    expect(out).not.toContain("eyJhbGciOi.eyJzdWIi.c2ln");
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("[email]");
    expect(out).toContain("Bearer [redactado]");
    expect(out).toContain("[jwt]");
    expect(out).toContain("postgres://worker:[redactado]@db:5432/x");
  });

  it("serializa errores redactando mensaje y stack", () => {
    const error = Object.assign(new Error("no se pudo notificar a ana@example.com"), {
      code: "E1",
    });
    const out = redact(error) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(out.code).toBe("E1");
    expect(out.message).toBe("no se pudo notificar a [email]");
    expect(String(out.stack)).not.toContain("ana@example.com");
  });

  it("tolera referencias circulares, profundidad excesiva y arreglos grandes", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect((redact(a) as Record<string, unknown>).self).toBe("[circular]");

    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).toContain("[profundidad]");

    const big = redact(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(big).toHaveLength(51);
    expect(big.at(-1)).toBe("[+10]");
  });
});
