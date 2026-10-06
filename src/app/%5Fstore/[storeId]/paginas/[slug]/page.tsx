import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPage } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { excerpt, pageMetadata } from "@/server/storefront/seo";
import { SafeHtml } from "@/ui/safe-html";

type Props = { params: Promise<{ storeId: string; slug: string }> };

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store, preview } = await getStorefront(storeId);
  const page = await getPage(store.id, slug);
  if (!page) notFound();
  return { store, preview, page };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview, page } = await load(params);
  return pageMetadata({
    store,
    preview,
    path: `/paginas/${page.slug}`,
    title: page.seo_title ?? page.title,
    description: page.seo_description ?? excerpt(page.body_html),
  });
}

export default async function StorePage({ params }: Props) {
  const { page } = await load(params);
  return (
    <article className="max-w-prose space-y-4">
      <h1 className="text-2xl font-semibold">{page.title}</h1>
      <SafeHtml html={page.body_html} className="sf-prose space-y-3" />
    </article>
  );
}
