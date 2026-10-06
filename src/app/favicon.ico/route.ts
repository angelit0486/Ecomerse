/**
 * Sin ícono de la plataforma: el storefront es marca blanca (GATE0 §20) y el
 * ícono por tienda llega con el tema. 204 evita el 404 de cada visita.
 */
export function GET(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "public, max-age=86400" } });
}
