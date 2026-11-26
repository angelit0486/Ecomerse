/**
 * ¿Cuenta este aviso de visita? (Visitantes de la tienda, 2026-11-26). Función
 * pura: el conteo es una estadística, no una medida de seguridad; esto solo
 * evita inflarlo con robots y con avisos que no vienen de la propia tienda.
 */
const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|headless|lighthouse|pagespeed|preview|curl|wget|python|axios|node-fetch|go-http/i;

export function shouldCountVisit(h: {
  userAgent: string | null;
  secFetchSite: string | null;
  preview: boolean;
}): boolean {
  if (h.preview) return false;
  // El navegador marca de dónde sale la petición: solo cuenta la de la misma tienda.
  if (h.secFetchSite !== null && h.secFetchSite !== "same-origin") return false;
  const ua = h.userAgent?.trim() ?? "";
  if (ua === "" || BOT_UA.test(ua)) return false;
  return true;
}
