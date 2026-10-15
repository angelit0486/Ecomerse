import { mediaUrl, searchSuggestions } from "@/server/storefront/catalog";
import { storefrontForRoute } from "@/server/storefront/context";

import { money } from "../../_components/format";
import type { SuggestionItem } from "../../_components/search-box";

/**
 * Sugerencias del buscador (F9-T04, F9-DESIGN §10): JSON con cada opción ya
 * lista para pintar (texto, detalle y enlace). La tienda sale de la firma del
 * proxy, nunca del comprador.
 */
type Params = { params: Promise<{ storeId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { store } = resolved;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const s = await searchSuggestions(store.id, q);
  const items: SuggestionItem[] = [
    ...s.products.map((p) => ({
      kind: "product" as const,
      label: p.title,
      detail: [p.brand, p.min_price !== null ? money(p.min_price, store) : null]
        .filter(Boolean)
        .join(" · "),
      href: `/productos/${p.slug}`,
      image: p.image ? mediaUrl(p.image.path) : null,
    })),
    ...s.values.map((v) => ({
      kind: "value" as const,
      label: v.label,
      detail: v.attribute_name,
      href: `/productos?${new URLSearchParams([[v.attribute, v.key]]).toString()}`,
      image: null,
    })),
    ...s.categories.map((c) => ({
      kind: "category" as const,
      label: c.name,
      detail: "Categoría",
      href: `/categoria/${c.path}`,
      image: null,
    })),
    ...s.brands.map((b) => ({
      kind: "brand" as const,
      label: b.name,
      detail: "Marca",
      href: `/marca/${encodeURIComponent(b.slug)}`,
      image: null,
    })),
  ];
  return Response.json(
    { items },
    { headers: { "cache-control": "private, max-age=30", "x-robots-tag": "noindex" } },
  );
}
