import { clientIpHash } from "@/server/storefront/cart";
import { mediaUrl, searchSuggestions } from "@/server/storefront/catalog";
import { storefrontForRoute } from "@/server/storefront/context";
import {
  createSuggestionsGuard,
  SUGGESTIONS_WINDOW_MS,
} from "@/server/storefront/suggestions-guard";

import { money } from "../../_components/format";
import type { SuggestionItem } from "../../_components/search-box";

/**
 * Sugerencias del buscador (F9-T04, F9-DESIGN §10): JSON con cada opción ya
 * lista para pintar (texto, detalle y enlace). La tienda sale de la firma del
 * proxy, nunca del comprador.
 */
type Params = { params: Promise<{ storeId: string }> };

/** Por instancia: límite por IP y una sola consulta en curso (ver suggestions-guard). */
const guard = createSuggestionsGuard();

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const turn = guard.take(await clientIpHash());
  if (!turn) {
    // El buscador trata cualquier respuesta no-ok como «sin sugerencias».
    return Response.json(
      { items: [] },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(Math.ceil(SUGGESTIONS_WINDOW_MS / 1000)),
          "x-robots-tag": "noindex",
        },
      },
    );
  }
  let resolved: Awaited<ReturnType<typeof storefrontForRoute>>;
  let s: Awaited<ReturnType<typeof searchSuggestions>>;
  try {
    resolved = await storefrontForRoute((await params).storeId, request.headers);
    if (!resolved) return new Response("Not found", { status: 404 });
    const q = new URL(request.url).searchParams.get("q") ?? "";
    s = await searchSuggestions(resolved.store.id, q);
  } finally {
    turn.release();
  }
  const { store, preview } = resolved;
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
    {
      headers: {
        // En la vista previa incluye borradores (ADR-032): no se guarda ni en el navegador.
        "cache-control": preview ? "no-store" : "private, max-age=30",
        "x-robots-tag": "noindex",
      },
    },
  );
}
