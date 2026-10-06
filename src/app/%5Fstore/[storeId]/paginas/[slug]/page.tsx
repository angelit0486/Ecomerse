import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPage } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { SafeHtml } from "@/ui/safe-html";

type Props = { params: Promise<{ storeId: string; slug: string }> };

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store } = await getStorefront(storeId);
  const page = await getPage(store.id, slug);
  if (!page) notFound();
  return { store, page };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, page } = await load(params);
  return {
    title: { absolute: `${page.seo_title ?? page.title} · ${store.name}` },
    ...(page.seo_description ? { description: page.seo_description } : {}),
  };
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
