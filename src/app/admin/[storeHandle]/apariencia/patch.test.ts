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

  it("una ruta escrita sin la diagonal inicial sigue siendo de la tienda", () => {
    expect(normalizeLink("categoria/proteinas")).toBe("/categoria/proteinas");
    expect(normalizeLink(" ofertas ")).toBe("/ofertas");
    expect(normalizeLink("marca.com/promo")).toBe("https://marca.com/promo");
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

  it("encabezado: la barra se puede ocultar sin borrarla", () => {
    const base = {
      announcement_text: "Buen Fin",
      announcement_background: "#111827",
      announcement_foreground: "#ffffff",
      announcement_toggle: "1",
    };
    const off = form(base);
    const hidden = sectionPatch("encabezado", off.get, off.getAll);
    expect(hidden.header).toHaveProperty("announcement", {
      text: "Buen Fin",
      background: "#111827",
      foreground: "#ffffff",
      hidden: true,
    });
    expect(validatePatch(hidden)).toEqual({ ok: true, patch: hidden });
    const on = form({ ...base, announcement_shown: "1" });
    expect(sectionPatch("encabezado", on.get, on.getAll).header).not.toHaveProperty(
      "announcement.hidden",
    );
  });

  it("barra de categorías: enlaces limpios, estilo y reemplaza a los accesos rápidos", () => {
    const { get, getAll } = form({
      nav_present: "1",
      nav_items: JSON.stringify([
        { label: "  Todos ", link: "productos", visibility: "all" },
        { label: "Energía", link: "/categoria/energia", visibility: "mobile" },
        { label: "", link: "" },
      ]),
      nav_style: "pills",
      nav_sticky: "1",
      nav_align: "start",
      nav_size: "sm",
      nav_visibility: "all",
      quick_label_0: "Viejo",
      quick_link_0: "/x",
    });
    const patch = sectionPatch("encabezado", get, getAll);
    expect(patch.header).toEqual({
      nav_bar: {
        items: [
          { label: "Todos", link: "/productos" },
          { label: "Energía", link: "/categoria/energia", visibility: "mobile" },
        ],
        style: "pills",
        sticky: true,
        visibility: "all",
      },
    });
    expect(validatePatch(patch)).toEqual({ ok: true, patch });
  });

  it("barra de categorías: un enlace no válido se marca en la lista", () => {
    const { get, getAll } = form({
      nav_present: "1",
      nav_items: JSON.stringify([{ label: "Malo", link: "javascript:alert(1)" }]),
    });
    expect(validatePatch(sectionPatch("encabezado", get, getAll))).toMatchObject({
      ok: false,
      fields: { nav_items: expect.any(String) },
    });
    const broken = form({ nav_present: "1", nav_items: "{no es json" });
    expect(sectionPatch("encabezado", broken.get, broken.getAll).header).toBeNull();
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
