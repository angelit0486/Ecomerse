/**
 * Sin ícono de la plataforma: el storefront es marca blanca (GATE0 §20) y el
 * ícono por tienda llega con el tema (F9). Un SVG vacío y transparente evita el
 * 404 de cada visita (204 no es válido en una ruta estática de Next).
 */
export function GET(): Response {
  return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  });
}
