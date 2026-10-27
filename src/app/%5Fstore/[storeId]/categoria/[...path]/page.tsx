import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCategory, mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { canonicalUrl, excerpt, pageMetadata } from "@/server/storefront/seo";

import { Breadcrumb } from "../../_components/breadcrumb";
import { JsonLd } from "../../_components/json-ld";
import { ProductListing, type SearchParams } from "../../_components/listing";

type Props = {
  params: Promise<{ storeId: string; path: string[] }>;
  searchParams: Promise<SearchParams>;
};

async function load(params: Props["params"]) {
  const { storeId, path } = await params;
  const { store, preview } = await getStorefront(storeId);
  // Los segmentos son slugs: algo distinto (incluido un %-escape malformado) es 404, no 500.
  if (path.length > 8 || !path.every((s) => /^[a-z0-9-]{1,120}$/.test(s))) notFound();
  const category = await getCategory(store.id, path.join("/"));
  if (!category) notFound();
  return { store, preview, category };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview, category } = await load(params);
  return pageMetadata({
    store,
    preview,
    path: `/categoria/${category.path}`,
    title: category.seo_title ?? category.name,
    description: category.seo_description ?? excerpt(category.description),
    image: category.image,
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { store, category } = await load(params);
  return (
    <div className="space-y-6">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              name: category.name,
              url: canonicalUrl(store, `/categoria/${category.path}`),
              ...(category.description ? { description: category.description } : {}),
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: category.breadcrumb.map((c, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: c.name,
                item: canonicalUrl(store, `/categoria/${c.path}`),
              })),
            },
          ],
        }}
      />
      <Breadcrumb
        items={[
          { label: "Inicio", href: "/" },
          ...category.breadcrumb.map((c) => ({ label: c.name, href: `/categoria/${c.path}` })),
        ]}
      />
      <header className="space-y-3">
        {category.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada; LCP de la categoría
          <img
            src={mediaUrl(category.cover.path)}
            alt=""
            width={category.cover.width ?? 1600}
            height={category.cover.height ?? 600}
            fetchPriority="high"
            decoding="async"
            className="block aspect-[8/3] w-full rounded-[var(--sf-radius-card)] object-cover"
          />
        ) : null}
        <div className="flex items-center gap-4">
          {category.image && !category.cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
            <img
              src={mediaUrl(category.image.path)}
              alt=""
              width={72}
              height={72}
              decoding="async"
              className="size-16 shrink-0 rounded-full object-cover ring-1 ring-[var(--sf-border)] sm:size-20"
            />
          ) : null}
          <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
            {category.name}
          </h1>
        </div>
        {category.description ? (
          <p className="max-w-prose whitespace-pre-line text-[var(--sf-muted)]">
            {category.description}
          </p>
        ) : null}
      </header>
      {category.children.length > 0 ? (
        <nav aria-label="Subcategorías">
          <ul className="flex flex-wrap gap-2 text-sm">
            {category.children.map((child) => (
              <li key={child.path}>
                <Link
                  prefetch={false}
                  href={`/categoria/${child.path}`}
                  className="inline-block rounded-[var(--sf-radius-btn)] border border-[var(--sf-border)] px-3 py-1 hover:bg-[var(--sf-surface)]"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <ProductListing
        store={store}
        basePath={`/categoria/${category.path}`}
        searchParams={await searchParams}
        categoryPath={category.path}
        emptyTitle="Esta categoría aún no tiene productos"
        emptyText="Vuelve pronto o explora el resto del catálogo."
      />
    </div>
  );
}
