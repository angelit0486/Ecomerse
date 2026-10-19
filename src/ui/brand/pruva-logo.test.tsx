import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PruvaLogo, PruvaSymbol, PruvaWordmark } from "./pruva-logo";

const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const master = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../../docs/marca/pruva/${name}`, import.meta.url)),
    "utf8",
  );

describe("marca PRUVA (fase 3)", () => {
  it("cada versión es una imagen con nombre accesible y toma el color del contenedor", () => {
    for (const markup of [
      renderToStaticMarkup(<PruvaLogo />),
      renderToStaticMarkup(<PruvaSymbol />),
      renderToStaticMarkup(<PruvaWordmark />),
    ]) {
      expect(markup).toContain('role="img"');
      expect(markup).toContain('aria-label="PRUVA"');
      expect(markup).toContain("currentColor");
      expect(markup).not.toMatch(/#[0-9a-f]{6}/i);
    }
  });

  it("los archivos maestros de docs/marca tienen la misma geometría que el componente", () => {
    expect(paths(master("pruva-horizontal-marino.svg"))).toEqual(
      paths(renderToStaticMarkup(<PruvaLogo />)),
    );
    expect(paths(master("pruva-simbolo-marino.svg"))).toEqual(
      paths(renderToStaticMarkup(<PruvaSymbol />)),
    );
    expect(paths(master("pruva-logotipo-blanco.svg"))).toEqual(
      paths(renderToStaticMarkup(<PruvaWordmark />)),
    );
  });

  it("el ícono del panel es el símbolo sobre azul marino", () => {
    const icon = readFileSync(
      fileURLToPath(new URL("../../../public/brand/pruva-icon.svg", import.meta.url)),
      "utf8",
    );
    expect(icon).toContain('fill="#0b2d5b"');
    expect(paths(icon)).toEqual(paths(renderToStaticMarkup(<PruvaSymbol />)));
  });
});
