import { describe, expect, it } from "vitest";

import { normalizeLink, normalizeWhatsapp, sectionPatch, validatePatch } from "./patch";

function form(values: Record<string, string | string[]>) {
  return {
    get: (k: string) => {
      const v = values[k];
      return typeof v === "string" ? v : "";
    },
    getAll: (k: string) => {
      const v = values[k];
      return Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    },
  };
}

describe("enlaces y WhatsApp escritos por una persona", () => {
  it("agrega https y pasa el dominio a minúsculas", () => {
    expect(normalizeLink("Instagram.com/MiTienda")).toBe("https://instagram.com/MiTienda");
    expect(normalizeLink("https://WWW.Example.com/Promo?x=1")).toBe(
      "https://www.example.com/Promo?x=1",
    );
    expect(normalizeLink("/productos")).toBe("/productos");
  });

  it("no convierte en válido lo que no lo es", () => {
    expect(normalizeLink("http://example.com")).toBe("http://example.com");
    expect(normalizeLink("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeLink("https://a@example.com")).toBe("https://a@example.com");
  });

  it("WhatsApp de 10 dígitos se toma como de México", () => {
    expect(normalizeWhatsapp("55 1234 5678")).toBe("+525512345678");
    expect(normalizeWhatsapp("+1 (415) 555-0100")).toBe("+14155550100");
  });
});

describe("parche de cada pestaña", () => {
  it("encabezado y pie: sin texto de anuncio no hay barra; vacío = null", () => {
    const { get, getAll } = form({ logo_position: "center", announcement_text: "  " });
    expect(sectionPatch("encabezado", get, getAll)).toEqual({
      header: { logo_position: "center" },
      footer: null,
    });
  });

  it("barra de anuncio completa y medios de pago sin repetir ni desconocidos", () => {
    const { get, getAll } = form({
      announcement_text: "Envío  gratis",
      announcement_link: "tienda.mx/envios",
      announcement_background: "#111827",
      announcement_foreground: "#FFFFFF",
      legal_text: "Línea 1\r\n\r\n\r\nLínea 2  ",
      payment_methods: ["visa", "visa", "bitcoin", "oxxo"],
    });
    expect(sectionPatch("encabezado", get, getAll)).toEqual({
      header: {
        announcement: {
          text: "Envío gratis",
          link: "https://tienda.mx/envios",
          background: "#111827",
          foreground: "#ffffff",
        },
      },
      footer: { legal_text: "Línea 1\n\nLínea 2", payment_methods: ["visa", "oxxo"] },
    });
  });

  it("redes y contacto", () => {
    const { get, getAll } = form({ social_instagram: "instagram.com/x", whatsapp: "5512345678" });
    const patch = sectionPatch("redes", get, getAll);
    expect(patch).toEqual({
      social: [{ network: "instagram", url: "https://instagram.com/x" }],
      contact: { whatsapp: "+525512345678" },
    });
    expect(validatePatch(patch)).toEqual({ ok: true, patch });
  });

  it("los errores llegan al campo del formulario", () => {
    const { get, getAll } = form({
      social_instagram: "https://evil.com/x",
      seo_title: "a".repeat(80),
    });
    expect(validatePatch(sectionPatch("redes", get, getAll))).toEqual({
      ok: false,
      fields: { social_instagram: "La dirección debe ser https:// de esa red social." },
    });
    expect(validatePatch(sectionPatch("seo", get, getAll))).toEqual({
      ok: false,
      fields: { seo_title: "Máximo 70 caracteres." },
    });
  });
});

describe("tema v2 en el panel (ADR-034)", () => {
  const ID = "00000000-0000-4000-8000-000000000005";

  it("marca: sombra, densidad y favicon; lo de siempre no se guarda", () => {
    const { get, getAll } = form({ shadow: "soft", density: "comfortable", favicon_media_id: ID });
    const patch = sectionPatch("marca", get, getAll);
    expect(patch.shape).toEqual({ shadow: "soft" });
    expect(patch.favicon_media_id).toBe(ID);
    expect(sectionPatch("marca", form({}).get, form({}).getAll).favicon_media_id).toBeNull();
  });

  it("encabezado: anuncio con fechas y accesos rápidos; renglones vacíos fuera", () => {
    const { get, getAll } = form({
      announcement_text: "Buen Fin",
      announcement_background: "#111827",
      announcement_foreground: "#ffffff",
      announcement_starts_at: "2026-11-13T06:00:00.000Z",
      announcement_ends_at: "",
      quick_label_0: " Ofertas ",
      quick_link_0: "/ofertas",
      quick_label_2: "Proteínas",
      quick_link_2: "/categoria/proteinas",
    });
    const patch = sectionPatch("encabezado", get, getAll);
    expect(patch.header).toEqual({
      announcement: {
        text: "Buen Fin",
        background: "#111827",
        foreground: "#ffffff",
        starts_at: "2026-11-13T06:00:00.000Z",
      },
      quick_links: [
        { label: "Ofertas", link: "/ofertas" },
        { label: "Proteínas", link: "/categoria/proteinas" },
      ],
    });
    expect(validatePatch(patch)).toEqual({ ok: true, patch });
  });

  it("un acceso rápido sin nombre se marca en su campo", () => {
    const { get, getAll } = form({ quick_link_1: "/ofertas" });
    expect(validatePatch(sectionPatch("encabezado", get, getAll))).toEqual({
      ok: false,
      fields: { quick_label_0: "Escribe este campo." },
    });
  });

  it("ficha y listados: solo se guarda lo que cambia respecto a la tienda por omisión", () => {
    const defaults = form({
      show_price_per_serving: "1",
      show_related: "1",
      sticky_buy_bar: "1",
      show_brand: "1",
      columns_mobile: "2",
      gallery: "thumbnails",
    });
    const plain = sectionPatch("presentacion", defaults.get, defaults.getAll);
    expect(plain).toEqual({ product_page: null, listing: null });
    const custom = form({ gallery: "dots", show_related: "1", columns_mobile: "1" });
    expect(sectionPatch("presentacion", custom.get, custom.getAll)).toEqual({
      product_page: {
        gallery: "dots",
        show_price_per_serving: false,
        sticky_buy_bar: false,
      },
      listing: { columns_mobile: 1, show_brand: false },
    });
  });
});
