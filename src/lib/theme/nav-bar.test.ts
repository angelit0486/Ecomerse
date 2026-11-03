import { describe, expect, it } from "vitest";

import { activeNavIndex, leftCut, navBarItems, navScrollTarget } from "./nav-bar";

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

describe("navScrollTarget (lote 2: sin palabras cortadas)", () => {
  // Siete enlaces de 100 px separados 4 px, lista de 375 px con relleno de 6 px.
  const items = Array.from({ length: 7 }, (_, i) => ({ start: 6 + i * 104, width: 100 }));
  const starts = new Set(items.map((i) => i.start - 6));
  const max = items[6]!.start + 100 + 6 - 375;

  it("con el primero activo no se desplaza", () => {
    expect(navScrollTarget(items, 0, 375, 6)).toEqual({ left: 0, extraEnd: 0 });
  });

  it("el activo se ve completo y el borde izquierdo es el inicio de un enlace", () => {
    for (let active = 1; active < items.length; active += 1) {
      const { left, extraEnd } = navScrollTarget(items, active, 375, 6);
      const a = items[active]!;
      expect(a.start).toBeGreaterThanOrEqual(left);
      expect(a.start + a.width).toBeLessThanOrEqual(left + 375);
      expect(left === 0 || starts.has(left)).toBe(true);
      // Solo pide espacio al final cuando hace falta para alinear.
      expect(left).toBeLessThanOrEqual(max + extraEnd);
    }
  });

  it("el último activo pide el espacio justo para alinear el borde", () => {
    const { left, extraEnd } = navScrollTarget(items, 6, 375, 6);
    expect(starts.has(left)).toBe(true);
    expect(extraEnd).toBe(left - max);
    expect(extraEnd).toBeLessThan(104);
  });

  it("antes (centrar sin alinear) cortaba el primer enlace visible", () => {
    const a = items[4]!;
    const old = a.start - (375 - a.width) / 2;
    expect(starts.has(old)).toBe(false);
    expect(starts.has(navScrollTarget(items, 4, 375, 6).left)).toBe(true);
  });

  it("sin enlace activo, al inicio", () => {
    expect(navScrollTarget(items, -1, 375, 6)).toEqual({ left: 0, extraEnd: 0 });
  });

  it("leftCut: solo hay corte si el borde no coincide con el inicio de un enlace", () => {
    expect(leftCut(items, 0, 6)).toBe(false);
    expect(leftCut(items, 104, 6)).toBe(false);
    expect(leftCut(items, 361, 6)).toBe(true);
  });
});
