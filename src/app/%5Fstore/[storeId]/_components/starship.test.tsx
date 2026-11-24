import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { lookCss } from "@/lib/theme/looks";

import { Starship } from "./starship";

describe("nave del look Nocturno sobre el título de la portada", () => {
  const html = renderToStaticMarkup(<Starship />);

  it("es decorativa: oculta al lector de pantalla y fuera del orden de foco", () => {
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('focusable="false"');
  });

  it("no pesa ni pide nada: SVG en línea de menos de 3 KB, sin imágenes ni estilos en línea", () => {
    expect(new TextEncoder().encode(html).length).toBeLessThan(3072);
    expect(html).not.toMatch(/<image|href=|style=/);
    // Sin colores propios: los pone el look desde su paleta.
    expect(html).not.toMatch(/="#[0-9a-f]{3,6}"/i);
  });

  it("tamaño fijo desde el HTML: el título no se mueve al cargar", () => {
    expect(html).toMatch(/<svg[^>]*width="160"[^>]*height="104"/);
    expect(html).toContain('viewBox="0 0 160 104"');
  });

  it("su movimiento solo usa transform y opacity, y respeta «reducir movimiento»", () => {
    const css = lookCss("nocturno");
    const frames = css.match(/@keyframes ad-ship-[a-z]+\{.*?\}\}/g) ?? [];
    expect(frames).toHaveLength(4);
    for (const kf of frames) {
      const props = [...kf.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const prop of props) expect(["transform", "opacity"]).toContain(prop);
    }
    // Las animaciones de la nave solo existen dentro del bloque sin movimiento reducido.
    const outside = css.replace(/@media \(prefers-reduced-motion:no-preference\)\{.*?\}\}+/g, "");
    expect(outside).not.toMatch(/ad-ship-(in|hover|light|beam) /);
  });
});
