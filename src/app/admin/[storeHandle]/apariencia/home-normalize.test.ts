import { describe, expect, it } from "vitest";

import { normalizeSections, sectionIssues } from "./home-normalize";

const ID = "00000000-0000-4000-8000-000000000001";

describe("secciones del editor de portada", () => {
  it("recorta, quita opcionales vacíos, normaliza enlaces y sanitiza el HTML", () => {
    expect(
      normalizeSections([
        {
          id: ID,
          type: "hero",
          enabled: true,
          props: {
            heading: "  Todo   para tu objetivo ",
            subheading: "",
            align: "center",
            image_media_id: "",
            cta: { label: "", link: "" },
          },
        },
        {
          id: ID.replace(/1$/, "2"),
          type: "rich_text",
          enabled: true,
          props: { heading: "", html: '<p onclick="x()">Hola</p><script>alert(1)</script>' },
        },
        {
          id: ID.replace(/1$/, "3"),
          type: "promo_banner",
          enabled: true,
          props: { image_media_id: ID, cta: { label: " Ver ", link: "Tienda.mx/Promo" } },
        },
      ]),
    ).toEqual([
      {
        id: ID,
        type: "hero",
        enabled: true,
        props: { heading: "Todo para tu objetivo", align: "center" },
      },
      {
        id: ID.replace(/1$/, "2"),
        type: "rich_text",
        enabled: true,
        props: { html: "<p>Hola</p>" },
      },
      {
        id: ID.replace(/1$/, "3"),
        type: "promo_banner",
        enabled: true,
        props: { image_media_id: ID, cta: { label: "Ver", link: "https://tienda.mx/Promo" } },
      },
    ]);
  });

  it("los errores van a su sección, con el nombre del campo y en español", () => {
    const input = normalizeSections([
      { id: ID, type: "hero", enabled: true, props: { heading: "", align: "center" } },
      {
        id: ID.replace(/1$/, "2"),
        type: "image_with_text",
        enabled: true,
        props: { image_media_id: "", heading: "Nosotros", body: "Texto", image_position: "left" },
      },
    ]);
    expect(sectionIssues(input)).toEqual({
      [ID]: ["Título: Escribe este campo."],
      [ID.replace(/1$/, "2")]: ["Imagen: Elige una opción."],
    });
  });
});
