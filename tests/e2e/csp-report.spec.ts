import { expect, test } from "@playwright/test";

/**
 * Reportes de CSP (auditoría global, paso 23): las páginas anuncian a dónde
 * reportar (el panel, con URL absoluta) y el receptor acepta los dos formatos,
 * rechaza lo que no es JSON y lo demasiado grande.
 */
test("CSP con report-to y receptor de reportes", async ({ request }) => {
  const page = await request.get("/login");
  const csp = page.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/report-uri https?:\/\/[^ ;]+\/api\/csp-report; report-to csp/);
  expect(page.headers()["reporting-endpoints"]).toMatch(
    /^csp="https?:\/\/[^"]+\/api\/csp-report"$/,
  );

  // Siempre bytes: con content-type JSON, Playwright volvería a serializar un texto.
  const post = (type: string, body: string) =>
    request.post("/api/csp-report", {
      headers: { "content-type": type },
      data: Buffer.from(body),
    });
  const legacy = await post(
    "application/csp-report",
    JSON.stringify({
      "csp-report": {
        "document-uri": "http://localhost:3000/pedido/x?t=SECRETO",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://malo.example/x.js",
      },
    }),
  );
  expect(legacy.status()).toBe(204);
  const modern = await post(
    "application/reports+json",
    JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src" } }]),
  );
  expect(modern.status()).toBe(204);
  expect((await post("application/json", "no es json")).status()).toBe(400);
  expect((await post("application/json", JSON.stringify({ x: "a".repeat(20_000) }))).status()).toBe(
    413,
  );
});
