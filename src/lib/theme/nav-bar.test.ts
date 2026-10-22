import { describe, expect, it } from "vitest";

import { activeNavIndex, navBarItems } from "./nav-bar";

const menu = [
  { label: "Proteínas", href: "/categoria/proteinas", children: [] },
  {
    label: "Objetivos",
    href: "/productos",
    children: [{ label: "Energía", href: "/productos?objetivo=energia" }],
  },
];

describe("barra de categorías", () => {
  it("los enlaces elegidos ganan a los accesos rápidos y a los automáticos", () => {
    expect(
      navBarItems({
        config: {
          items: [
            { label: "Todos", link: "/productos" },
            { label: "Fuerza", link: "/c", visibility: "mobile" },
          ],
        },
        quickLinks: [{ label: "Viejo", link: "/x" }],
        menu,
        discovery: [],
      }),
    ).toEqual([
      { label: "Todos", href: "/productos", visibility: "all" },
      { label: "Fuerza", href: "/c", visibility: "mobile" },
    ]);
    expect(
      navBarItems({ quickLinks: [{ label: "Viejo", link: "/x" }], menu, discovery: [] }),
    ).toEqual([{ label: "Viejo", href: "/x", visibility: "all" }]);
  });

  it("automáticos: ofertas primero, más vendidos, hojas del menú y sin repetir", () => {
    const items = navBarItems({
      menu,
      discovery: [
        { label: "Marcas", href: "/marcas" },
        { label: "Ofertas", href: "/ofertas" },
      ],
    });
    expect(items.map((i) => i.href)).toEqual([
      "/ofertas",
      "/productos?orden=best_selling",
      "/categoria/proteinas",
      "/productos?objetivo=energia",
      "/marcas",
    ]);
  });

  it("activo: misma ruta y parámetros; gana el más específico", () => {
    const items = [
      { href: "/productos" },
      { href: "/productos?objetivo=energia" },
      { href: "/categoria/proteinas" },
      { href: "https://otra.com/productos" },
    ];
    expect(activeNavIndex(items, "/productos", "?objetivo=energia&pagina=2")).toBe(1);
    expect(activeNavIndex(items, "/productos", "")).toBe(0);
    expect(activeNavIndex(items, "/categoria/proteinas/", "")).toBe(2);
    expect(activeNavIndex(items, "/carrito", "")).toBe(-1);
  });
});
