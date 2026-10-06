import { storefrontForRoute } from "@/server/storefront/context";
import { canonicalUrl, indexable } from "@/server/storefront/seo";

/** robots.txt por host (GATE0 §24). Borrador o vista previa: Disallow: / y noindex. */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { store, preview } = resolved;
  const body = indexable(store, preview)
    ? [
        "User-agent: *",
        "Allow: /",
        ...["/carrito", "/checkout", "/cuenta", "/buscar", "/pedido", "/_preview"].map(
          (p) => `Disallow: ${p}`,
        ),
        `Sitemap: ${canonicalUrl(store, "/sitemap.xml")}`,
        "",
      ].join("\n")
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...(indexable(store, preview) ? {} : { "x-robots-tag": "noindex" }),
    },
  });
}
