import { describe, expect, it } from "vitest";

import { parsePreviewLinks } from "./preview-links";

describe("parsePreviewLinks (D-F9-17)", () => {
  it("lee etiqueta y URL en orden", () => {
    expect(
      parsePreviewLinks("Tienda A|https://a.example.com, Tienda B | https://b.example.com/"),
    ).toEqual([
      { label: "Tienda A", url: "https://a.example.com/" },
      { label: "Tienda B", url: "https://b.example.com/" },
    ]);
  });

  it("sin valor no hay enlaces", () => {
    expect(parsePreviewLinks(undefined)).toEqual([]);
    expect(parsePreviewLinks("")).toEqual([]);
  });

  it("ignora lo inválido: sin https, sin etiqueta, credenciales o URL rota", () => {
    expect(
      parsePreviewLinks(
        "A|http://a.example.com,|https://b.example.com,C|https://u:p@c.example.com,D|nada,E|javascript:alert(1)",
      ),
    ).toEqual([]);
  });

  it("descarta la consulta y el fragmento, y corta en 6", () => {
    const raw = Array.from({ length: 8 }, (_, i) => `T${i}|https://t${i}.example.com/x?y=1#z`).join(
      ",",
    );
    const links = parsePreviewLinks(raw);
    expect(links).toHaveLength(6);
    expect(links[0]).toEqual({ label: "T0", url: "https://t0.example.com/x" });
  });
});
