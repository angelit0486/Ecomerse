import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  generateNonce,
  reportEndpoint,
} from "./headers";

describe("cabeceras de seguridad", () => {
  it("genera nonces aleatorios en base64 de 128 bits", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });

  it("CSP de producción: nonce, strict-dynamic y sin unsafe-*", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc", isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'nonce-abc'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // ADR-034: solo los reproductores de YouTube (sin cookies) y Vimeo.
    expect(csp).toContain("frame-src https://www.youtube-nocookie.com https://player.vimeo.com;");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("CSP de desarrollo permite lo que necesita HMR", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc", isDev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("permite solo el origen de Storage para subidas e imágenes", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "n",
      isDev: false,
      storageOrigin: "https://abc.supabase.co/ruta?x=1",
    });
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co;");
    expect(csp).toContain("img-src 'self' blob: data: https://abc.supabase.co;");
    for (const bad of ["javascript:alert(1)", "*", "nada"]) {
      expect(
        buildContentSecurityPolicy({ nonce: "n", isDev: false, storageOrigin: bad }),
      ).toContain("connect-src 'self';");
    }
  });

  it("incluye las cabeceras endurecidas y HSTS solo cuando se pide", () => {
    const prod = buildSecurityHeaders({ nonce: "n", isDev: false, enableHsts: true });
    expect(prod).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
    expect(prod["Permissions-Policy"]).toContain("camera=()");
    const dev = buildSecurityHeaders({ nonce: "n", isDev: true, enableHsts: false });
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });

  it("manda los reportes de CSP al panel, nunca a otro lado (paso 23)", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "n",
      isDev: false,
      reportOrigin: "https://app.pruva.mx/cualquier/ruta?x=1",
    });
    expect(csp).toContain("report-uri https://app.pruva.mx/api/csp-report; report-to csp");
    const headers = buildSecurityHeaders({
      nonce: "n",
      isDev: false,
      enableHsts: false,
      reportOrigin: "https://app.pruva.mx",
    });
    expect(headers["Reporting-Endpoints"]).toBe('csp="https://app.pruva.mx/api/csp-report"');
    for (const bad of [undefined, "javascript:alert(1)", "nada"]) {
      expect(reportEndpoint(bad)).toBeNull();
      expect(
        buildContentSecurityPolicy({ nonce: "n", isDev: false, reportOrigin: bad }),
      ).not.toContain("report-");
    }
  });
});
