import { describe, expect, it } from "vitest";

import { contrastRatio } from "@/lib/color/contrast";

import { GOAL_PALETTE, goalColors } from "./goal-colors";

describe("goalColors (bloques de objetivo)", () => {
  it.each(GOAL_PALETTE.map((c) => [c.bg, c] as const))(
    "%s lleva texto con contraste ≥ 4.5:1",
    (_, color) => {
      expect(contrastRatio(color.fg, color.bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("los objetivos conocidos tienen su color y los demás toman los libres sin repetir", () => {
    const [fuerza, nuevo, energia, otro] = goalColors(["fuerza", "inmunidad", "energia", "foco"]);
    expect(fuerza).toEqual({ bg: "#cf4410", fg: "#ffffff" });
    expect(energia).toEqual({ bg: "#f5c400", fg: "#2b2300" });
    expect(new Set([fuerza, nuevo, energia, otro].map((c) => c!.bg)).size).toBe(4);
  });

  it("dos claves con el mismo color: la segunda toma otro", () => {
    const [a, b] = goalColors(["fuerza", "masa-muscular"]);
    expect(a!.bg).not.toBe(b!.bg);
  });

  it("con más objetivos que colores, vuelve a empezar", () => {
    const keys = Array.from({ length: GOAL_PALETTE.length + 2 }, (_, i) => `objetivo-${i}`);
    const colors = goalColors(keys);
    expect(colors).toHaveLength(keys.length);
    expect(colors.every(Boolean)).toBe(true);
  });
});
