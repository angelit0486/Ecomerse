import { beforeEach, describe, expect, it, vi } from "vitest";

const env = { APP_ENV: "production", APP_HOSTNAME: "app.example.com" };
vi.mock("@/server/env", () => ({
  serverEnv: () => ({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://s.example.co" }),
}));
vi.mock("./catalog", () => ({ mediaUrl: (p: string) => `https://s.example.co/m/${p}` }));

const { canonicalUrl, excerpt, indexable, jsonLd, pageMetadata } = await import("./seo");

const store = {
  id: "0190a0d0-0000-7000-8000-000000000001",
  name: "Moda Ana",
  handle: "moda-ana",
  status: "active",
  locale: "es-MX",
  currency: "MXN",
  country: "MX",
  primary_hostname: "moda-ana.tiendas.example.com",
};

beforeEach(() => {
  env.APP_ENV = "production";
});

describe("SEO por tienda", () => {
  it("canonical absoluto al dominio primario", () => {
    expect(canonicalUrl(store, "/productos/playera")).toBe(
      "https://moda-ana.tiendas.example.com/productos/playera",
    );
  });

  it("borrador o vista previa: noindex", () => {
    expect(indexable(store, false)).toBe(true);
    expect(indexable(store, true)).toBe(false);
    expect(indexable({ status: "draft" }, false)).toBe(false);
    expect(pageMetadata({ store, preview: true, path: "/", title: "Moda Ana" }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("título, OG y Twitter con la imagen", () => {
    const meta = pageMetadata({
      store,
      preview: false,
      path: "/productos/playera",
      title: "Playera",
      description: "Algodón",
      image: { path: "a/b.jpg", width: 800, height: 800, alt: null },
    });
    expect(meta.title).toEqual({ absolute: "Playera · Moda Ana" });
    expect(meta.alternates?.canonical).toBe(
      "https://moda-ana.tiendas.example.com/productos/playera",
    );
    expect(meta.openGraph).toMatchObject({ siteName: "Moda Ana", locale: "es_MX" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("sin descripción propia: una neutra con el nombre real", () => {
    expect(pageMetadata({ store, preview: false, path: "/", title: "Moda Ana" }).description).toBe(
      "Tienda en línea de Moda Ana.",
    );
    expect(
      pageMetadata({ store, preview: false, path: "/productos", title: "Productos" }).description,
    ).toBe("Productos en Moda Ana.");
  });

  it("extracto sin HTML y JSON-LD sin '<'", () => {
    expect(excerpt("<p>Hola <b>mundo</b></p>")).toBe("Hola mundo");
    expect(excerpt("palabra ".repeat(50))!.length).toBeLessThanOrEqual(160);
    expect(jsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});
