/**
 * Enlaces para compartir (O10-03). Solo usan datos públicos de la tienda:
 * nombre, título del producto y su dirección pública. Nunca datos de clientes,
 * precios de costo ni enlaces del panel.
 */

/** Enlace universal de WhatsApp: abre la app y deja que la persona elija el chat. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function productShareText(productTitle: string, url: string): string {
  return `Mira este producto: ${productTitle.trim()}\n${url}`;
}

export function storeShareText(storeName: string, url: string): string {
  return `Visita ${storeName.trim()} y haz tu pedido en línea:\n${url}`;
}

/** Nombre de archivo seguro para descargar el QR (sin acentos ni signos). */
export function qrFileName(base: string): string {
  const slug = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `qr-${slug || "tienda"}.png`;
}
