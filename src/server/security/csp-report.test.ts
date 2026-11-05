import { describe, expect, it } from "vitest";

import { logBudget, parseCspReports, redactUrl } from "./csp-report";

describe("reportes de CSP (paso 23)", () => {
  it("de cada URL guarda solo origen y ruta: nunca el token del enlace del pedido", () => {
    expect(redactUrl("https://tienda.mx/pedido/0190?t=SECRETO#x")).toBe(
      "https://tienda.mx/pedido/0190",
    );
    expect(redactUrl("inline")).toBe("inline");
    expect(redactUrl("chrome-extension://abc/script.js")).toBe("chrome-extension");
    expect(redactUrl("no es url")).toBe("otro");
    expect(redactUrl(42)).toBe("");
  });

  it("lee el formato de report-uri", () => {
    const [v] = parseCspReports({
      "csp-report": {
        "document-uri": "https://tienda.mx/checkout?email=ana@x.mx",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://malo.example/x.js?k=1",
        "source-file": "https://tienda.mx/_next/app.js",
        "line-number": 12,
        disposition: "enforce",
      },
    });
    expect(v).toEqual({
      directive: "script-src-elem",
      blocked: "https://malo.example/x.js",
      document: "https://tienda.mx/checkout",
      source: "https://tienda.mx/_next/app.js",
      line: 12,
      disposition: "enforce",
    });
  });

  it("lee la Reporting API e ignora otros tipos y reportes sin directiva", () => {
    const out = parseCspReports([
      {
        type: "csp-violation",
        body: { effectiveDirective: "img-src", blockedURL: "data", documentURL: "https://a.mx/" },
      },
      { type: "deprecation", body: { id: "x" } },
      { type: "csp-violation", body: { blockedURL: "https://b.mx" } },
      "basura",
    ]);
    expect(out).toEqual([
      {
        directive: "img-src",
        blocked: "data",
        document: "https://a.mx/",
        source: "",
        line: null,
        disposition: "enforce",
      },
    ]);
    expect(parseCspReports({ otra: 1 })).toEqual([]);
    expect(parseCspReports(null)).toEqual([]);
  });

  it("lee como mucho 20 reportes por petición", () => {
    const many = Array.from({ length: 50 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src" },
    }));
    expect(parseCspReports(many)).toHaveLength(20);
  });

  it("limita cuántos se registran por minuto", () => {
    const allow = logBudget(2, 60_000);
    expect([allow(0), allow(1), allow(2)]).toEqual([true, true, false]);
    expect(allow(60_000)).toBe(true);
  });
});
