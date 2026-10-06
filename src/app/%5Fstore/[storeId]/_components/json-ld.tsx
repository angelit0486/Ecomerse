import { jsonLd } from "@/server/storefront/seo";

/**
 * Datos estructurados (schema.org). Bloque de datos, no ejecutable: el JSON se
 * emite como texto con "<" escapado (sin dangerouslySetInnerHTML).
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json">{jsonLd(data)}</script>;
}
