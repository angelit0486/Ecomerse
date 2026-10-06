import { sitemapEntries } from "@/server/storefront/catalog";
import { storefrontForRoute } from "@/server/storefront/context";
import { canonicalUrl, indexable } from "@/server/storefront/seo";

/**
 * Sitemap por host (GATE0 §24): solo lo publicado de ESTA tienda, URLs absolutas
 * al dominio primario. Borrador o vista previa: vacío (no se indexa).
 */
const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const resolved = await storefrontForRoute((await params).storeId, request.headers);
  if (!resolved) return new Response("Not found", { status: 404 });
  const { store, preview } = resolved;
  const entries = indexable(store, preview) ? await sitemapEntries(store.id) : [];
  const urls = [
    `<url><loc>${escapeXml(canonicalUrl(store, "/"))}</loc></url>`,
    ...entries.map(
      (e) =>
        `<url><loc>${escapeXml(canonicalUrl(store, e.path))}</loc><lastmod>${new Date(e.lastmod).toISOString()}</lastmod></url>`,
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    indexable(store, preview) ? urls.join("\n") : ""
  }\n</urlset>\n`;
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      ...(indexable(store, preview) ? {} : { "x-robots-tag": "noindex" }),
    },
  });
}
