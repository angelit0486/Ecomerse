import { describe, expect, it } from "vitest";

import { classifyHost, isInternalStorePath, normalizeHost } from "./host";

describe("normalizeHost", () => {
  it.each([
    ["Tienda-A.Tiendas.Test", "tienda-a.tiendas.test"],
    ["tienda-a.tiendas.test:3000", "tienda-a.tiendas.test"],
    ["tienda-a.tiendas.test.", "tienda-a.tiendas.test"],
    ["localhost:3000", "localhost"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });

  it.each([null, "", "   ", "tienda a.test", "evil.com/path", "a..b", "-x.test", "x".repeat(254)])(
    "rechaza %s",
    (raw) => {
      expect(normalizeHost(raw)).toBeNull();
    },
  );
});

describe("classifyHost", () => {
  it("panel solo si coincide exactamente con APP_HOSTNAME", () => {
    expect(classifyHost("app.pruva.test", "app.pruva.test")).toBe("panel");
    expect(classifyHost("app.pruva.test.evil.com", "app.pruva.test")).toBe("storefront");
    expect(classifyHost("tienda.tiendas.test", "app.pruva.test")).toBe("storefront");
    expect(classifyHost(null, "app.pruva.test")).toBe("invalid");
  });
});

describe("isInternalStorePath", () => {
  it.each(["/_store", "/_store/x", "/_STORE/x", "/%5Fstore/x", "/%5fstore"])("bloquea %s", (p) => {
    expect(isInternalStorePath(p)).toBe(true);
  });
  it.each(["/", "/productos", "/_storefront-no", "/store"])("permite %s", (p) => {
    expect(isInternalStorePath(p)).toBe(false);
  });
});
