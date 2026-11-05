import { describe, expect, it } from "vitest";

import { OPTIONS, POST } from "./route";

const url = "https://app.pruva.test/api/csp-report";

describe("receptor de reportes de CSP (revisión 2026-11-05)", () => {
  it("responde la verificación previa de CORS que manda Chromium desde el host de una tienda", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("acepta un reporte y permite leerlo desde otro origen", async () => {
    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/reports+json", origin: "https://tienda.mx" },
        body: JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src" } }]),
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("corta un cuerpo sin Content-Length al pasar de 16 KB, sin leerlo completo", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(4096).fill(97);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) return controller.close();
        controller.enqueue(chunk);
      },
    });
    const res = await POST(
      new Request(url, { method: "POST", body, duplex: "half" } as RequestInit & {
        duplex: "half";
      }),
    );
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });
});
