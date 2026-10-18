import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GOAL_PALETTE } from "@/lib/theme/goal-colors";

vi.mock("@/server/storefront/catalog", () => ({ mediaUrl: (p: string) => `https://m.test/${p}` }));

const { GOAL_CLASSES, GoalTiles } = await import("./goal-chips");

describe("bloques de objetivo (rediseño A+B)", () => {
  it("cada color de la paleta tiene sus clases con el mismo par fondo/texto", () => {
    for (const color of GOAL_PALETTE) {
      expect(GOAL_CLASSES[color.bg]).toBe(`bg-[${color.bg}] text-[${color.fg}]`);
    }
  });

  it("conteo real en singular y plural, enlace al listado filtrado y foto decorativa", () => {
    const markup = renderToStaticMarkup(
      <GoalTiles
        goals={[
          {
            key: "fuerza",
            label: "Fuerza",
            count: 1,
            image: { path: "a.webp", width: 10, height: 10, alt: "Creatina" },
          },
          { key: "energia", label: "Energía", count: 12 },
        ]}
      />,
    );
    expect(markup).toContain('href="/productos?objetivo=fuerza"');
    const text = markup.replaceAll("<!-- -->", "");
    expect(text).toContain("1 producto<");
    expect(text).toContain("12 productos");
    expect(markup).toContain('alt=""');
    expect(markup).toContain("¿Qué quieres lograr?");
  });

  it("sin objetivos no muestra nada; compacto, sin título ni fotos", () => {
    expect(renderToStaticMarkup(<GoalTiles goals={[]} />)).toBe("");
    const compact = renderToStaticMarkup(
      <GoalTiles
        compact
        goals={[
          {
            key: "fuerza",
            label: "Fuerza",
            count: 3,
            image: { path: "a.webp", width: 1, height: 1, alt: null },
          },
        ]}
      />,
    );
    expect(compact).not.toContain("¿Qué quieres lograr?");
    expect(compact).not.toContain("<img");
  });
});
