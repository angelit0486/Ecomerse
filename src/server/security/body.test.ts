import { describe, expect, it } from "vitest";

import { readBodyLimited } from "./body";

function chunked(parts: string[]): Request {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Request("https://x.test/", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readBodyLimited", () => {
  it("devuelve el texto completo (UTF-8 entre trozos) si cabe", async () => {
    expect(await readBodyLimited(chunked(['{"a":"ñ', 'o"}']), 100)).toBe('{"a":"ño"}');
  });

  it("corta un cuerpo por trozos que se pasa del tope, sin content-length", async () => {
    expect(await readBodyLimited(chunked(["x".repeat(60), "x".repeat(60)]), 100)).toBeNull();
  });

  it("rechaza por content-length declarado antes de leer", async () => {
    const req = new Request("https://x.test/", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999" },
    });
    expect(await readBodyLimited(req, 100)).toBeNull();
  });

  it("acepta exactamente el tope", async () => {
    expect(await readBodyLimited(chunked(["x".repeat(100)]), 100)).toHaveLength(100);
  });
});
