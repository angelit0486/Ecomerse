import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("proxy", () => {
  it("aplica CSP con nonce y cabeceras de seguridad a la respuesta", () => {
    const response = proxy(new NextRequest("https://app.example.test/"));
    const csp = response.headers.get("content-security-policy");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]+=*' 'strict-dynamic'/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("asigna un request_id propio e ignora el enviado por el cliente", () => {
    const response = proxy(
      new NextRequest("https://app.example.test/", {
        headers: { "x-request-id": "valor-del-cliente" },
      }),
    );
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe("valor-del-cliente");
  });

  it("usa un nonce distinto en cada request", () => {
    const a = proxy(new NextRequest("https://app.example.test/")).headers.get(
      "content-security-policy",
    );
    const b = proxy(new NextRequest("https://app.example.test/")).headers.get(
      "content-security-policy",
    );
    expect(a).not.toBe(b);
  });
});
