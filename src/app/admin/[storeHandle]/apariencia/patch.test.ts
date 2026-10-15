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
