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

  it("bloques v2: renglones por tipo, enlace de video a código y sin opciones vacías (ADR-034)", () => {
    const [faq, benefits, video, hero] = normalizeSections([
      {
        id: ID,
        type: "faq",
        enabled: true,
        visibility: "all",
        starts_at: "",
        ends_at: "",
        props: {
          title: " Preguntas ",
          items: [{ question: " ¿Envían? ", answer: " Sí.\r\n\r\n\r\nEn 2 días ", quote: "x" }],
        },
      },
      {
        id: ID.replace(/1$/, "2"),
        type: "benefits",
        enabled: true,
        props: { title: "", items: [{ icon: "truck", title: " Envío ", text: "" }] },
      },
      {
        id: ID.replace(/1$/, "3"),
        type: "video",
        enabled: true,
        props: {
          provider: "youtube",
          video_id: " https://vimeo.com/76979871 ",
          title: "Así se hace",
          caption: "",
        },
      },
      {
        id: ID.replace(/1$/, "4"),
        type: "hero",
        enabled: true,
        visibility: "mobile",
        ends_at: "2026-11-17T06:00:00.000Z",
        props: { heading: "Buen Fin", align: "center" },
      },
    ]) as Record<string, unknown>[];
    expect(faq).toEqual({
      id: ID,
      type: "faq",
      enabled: true,
      props: { title: "Preguntas", items: [{ question: "¿Envían?", answer: "Sí.\n\nEn 2 días" }] },
    });
    expect(benefits!.props).toEqual({ items: [{ icon: "truck", title: "Envío" }] });
    expect(video!.props).toEqual({ provider: "vimeo", video_id: "76979871", title: "Así se hace" });
    expect(hero).toMatchObject({ visibility: "mobile", ends_at: "2026-11-17T06:00:00.000Z" });
    expect(sectionIssues([faq, benefits, video, hero])).toBeNull();
  });

  it("la vigencia al revés se marca en su sección", () => {
    const issues = sectionIssues([
      {
        id: ID,
        type: "hero",
        enabled: true,
        starts_at: "2026-11-17T06:00:00.000Z",
        ends_at: "2026-11-13T06:00:00.000Z",
        props: { heading: "a", align: "center" },
      },
    ]);
    expect(issues).toEqual({ [ID]: ["Mostrar hasta: El fin debe ser después del inicio."] });
  });
});
