import { describe, expect, it } from "vitest";

import { brokenLinkHint, sectionLinks, type LinkTargets } from "./link-targets";

const targets: LinkTargets = {
  categories: ["plumas", "suplementos/proteinas"],
  brands: ["ace-ultra"],
  pages: ["envios"],
  products: ["creatina-300-g"],
  redirects: ["/promo-vieja"],
};

describe("brokenLinkHint", () => {
  it("acepta las páginas reales de la tienda y los enlaces externos", () => {
    for (const link of [
      "/",
      "/productos",
      "/productos?objetivo=energia&orden=nuevos",
      "/ofertas#top",
      "/marcas",
      "/categoria/plumas",
      "/categoria/suplementos/proteinas/",
      "/marca/ace-ultra",
      "/paginas/envios#tiempos",
      "/productos/creatina-300-g",
      "/promo-vieja",
      "https://example.com/x",
      "",
    ]) {
      expect(brokenLinkHint(link, targets), link).toBeNull();
    }
  });

  it("«/plumas» (diagnóstico R3): avisa y sugiere la categoría", () => {
    expect(brokenLinkHint("/plumas", targets)).toBe(
      "«/plumas» no es una página de tu tienda. ¿Quisiste decir «/categoria/plumas»?",
    );
  });

  it("una categoría, marca o página que no existe", () => {
    expect(brokenLinkHint("/categoria/vapes", targets)).toBe(
      "«/categoria/vapes» no lleva a ninguna categoría de tu tienda.",
    );
    expect(brokenLinkHint("/marca/proteinas", targets)).toBe(
      "«/marca/proteinas» no lleva a ninguna marca de tu tienda. ¿Quisiste decir «/categoria/suplementos/proteinas»?",
    );
    expect(brokenLinkHint("/paginas/contacto", targets)).toMatch(/ninguna página/);
    expect(brokenLinkHint("/envios", targets)).toMatch(/«\/paginas\/envios»/);
    expect(brokenLinkHint("/ace-ultra", targets)).toMatch(/«\/marca\/ace-ultra»/);
  });
});

describe("brokenLinkHint sin datos completos (revisión del Paso 1)", () => {
  it("lo que no se pudo leer no avisa (rol sin permiso o consulta fallida)", () => {
    expect(brokenLinkHint("/productos/otro", { ...targets, products: null })).toBeNull();
    expect(brokenLinkHint("/plumas", { ...targets, redirects: null })).toBeNull();
    expect(brokenLinkHint("/categoria/x", { ...targets, categories: null })).toBeNull();
  });

  it("redirecciones sin importar mayúsculas y rutas de la cuenta", () => {
    expect(brokenLinkHint("/Promo-Vieja", targets)).toBeNull();
    expect(brokenLinkHint("/cuenta/pedidos", targets)).toBeNull();
    expect(brokenLinkHint("/cuenta", targets)).toBeNull();
  });
});

describe("sectionLinks", () => {
  it("encuentra los enlaces de botones, tarjetas y renglones", () => {
    expect(
      sectionLinks({
        heading: "Hola",
        cta: { label: "Ver", link: "/plumas" },
        slides: [{ cta: { label: "A", link: "/a" } }],
        items: [{ title: "x", link: "/b" }, { title: "y" }],
      }),
    ).toEqual(["/plumas", "/a", "/b"]);
  });
});
