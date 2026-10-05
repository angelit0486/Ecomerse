import { describe, expect, it } from "vitest";

import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each([
    ["/admin/mi-tienda/pedidos", "/admin/mi-tienda/pedidos"],
    ["/cuenta?tab=pedidos#ultimo", "/cuenta?tab=pedidos#ultimo"],
    ["/a/../b", "/b"],
  ])("acepta la ruta interna %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    " /admin",
    "/%0d%0aSet-Cookie:x",
  ])("rechaza el destino peligroso %j", (input) => {
    const result = safeRedirect(input, "/inicio");
    // Algunos (como el CRLF codificado) son rutas internas inofensivas tras normalizar;
    // lo esencial es que el resultado nunca salga del origen.
    expect(result.startsWith("/")).toBe(true);
    expect(result.startsWith("//")).toBe(false);
    expect(new URL(result, "https://app.example").origin).toBe("https://app.example");
  });

  it("devuelve el fallback para protocol-relative, esquemas, barras invertidas y control", () => {
    for (const input of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "/\t/evil.com",
      "javascript:x",
    ]) {
      expect(safeRedirect(input, "/inicio")).toBe("/inicio");
    }
  });

  it("rechaza tipos no string y rutas excesivamente largas", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(42)).toBe("/");
    expect(safeRedirect(`/${"a".repeat(3000)}`)).toBe("/");
  });
});
