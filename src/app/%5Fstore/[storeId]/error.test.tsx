import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: StorefrontError } = await import("./error");
const { default: RootError } = await import("../../error");

const leak = Object.assign(new Error("connect ETIMEDOUT db.internal:6543 password=x"), {
  digest: "123456",
});

describe("página de error amable de la tienda", () => {
  it("en español, con Reintentar y salidas al inicio y al carrito", () => {
    const html = renderToStaticMarkup(<StorefrontError error={leak} reset={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Esta página tardó en cargar");
    expect(html).toContain(">Reintentar</button>");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/carrito"');
    expect(html).toContain("Código de referencia: <code>123456</code>");
  });

  it("nunca muestra el mensaje interno del error", () => {
    for (const html of [
      renderToStaticMarkup(<StorefrontError error={leak} reset={() => {}} />),
      renderToStaticMarkup(<RootError error={leak} reset={() => {}} />),
    ]) {
      expect(html).not.toContain("ETIMEDOUT");
      expect(html).not.toContain("password");
    }
  });

  it("el respaldo general también tiene Reintentar e inicio, sin marca", () => {
    const html = renderToStaticMarkup(<RootError error={new Error("x")} reset={() => {}} />);
    expect(html).toContain(">Reintentar</button>");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Código de referencia");
  });
});
