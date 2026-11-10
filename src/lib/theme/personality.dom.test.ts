// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { MOTION_TARGETS, PERSONALITY_CSS } from "./personality";

describe("movimiento sutil (tema v5, revisión 2026-11-06)", () => {
  it("nunca toca el primer bloque de la portada, aunque haya etiquetas <style> antes", () => {
    expect(PERSONALITY_CSS).toContain(`${MOTION_TARGETS}{animation:sf-rise`);
    // El selector contra el marcado real de la portada (estilos de bloque arriba).
    const root = document.createElement("div");
    root.className = "sf-root";
    root.dataset.motion = "subtle";
    const home = document.createElement("div");
    home.className = "sf-home";
    for (const [tag, id] of [
      ["style", ""],
      ["style", ""],
      ["div", "hero"],
      ["section", "b"],
      ["div", "c"],
    ] as const) {
      const el = document.createElement(tag);
      if (id) el.id = id;
      home.append(el);
    }
    root.append(home);
    document.body.append(root);
    const moved = [...document.querySelectorAll(MOTION_TARGETS)].map((el) => el.id);
    expect(moved).toEqual(["b", "c"]);
  });
});
