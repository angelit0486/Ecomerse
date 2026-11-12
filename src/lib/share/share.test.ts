import { describe, expect, it } from "vitest";

import { productShareText, qrFileName, storeShareText, whatsappShareUrl } from "./share";

describe("compartir", () => {
  it("arma el enlace de WhatsApp con el texto codificado", () => {
    const url = whatsappShareUrl(
      productShareText("Playera básica & más", "https://ropa.mx/productos/playera"),
    );
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
    expect(text).toBe(
      "Mira este producto: Playera básica & más\nhttps://ropa.mx/productos/playera",
    );
    // Nada sin codificar que rompa el enlace.
    expect(url).not.toMatch(/[ \n#]/);
    expect(url.slice(20)).not.toContain("&");
  });

  it("el texto de la tienda lleva su nombre y su dirección", () => {
    expect(storeShareText(" Abarrotes Lupita ", "https://lupita.mx/")).toBe(
      "Visita Abarrotes Lupita y haz tu pedido en línea:\nhttps://lupita.mx/",
    );
  });

  it("nombre de archivo sin acentos ni signos", () => {
    expect(qrFileName("Té de manzanilla 100 g")).toBe("qr-te-de-manzanilla-100-g.png");
    expect(qrFileName("¿¡!?")).toBe("qr-tienda.png");
  });
});
