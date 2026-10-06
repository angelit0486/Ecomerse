import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCategory } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";

import { Breadcrumb } from "../../_components/breadcrumb";
import { ProductListing, type SearchParams } from "../../_components/listing";

type Props = {
  params: Promise<{ storeId: string; path: string[] }>;
  searchParams: Promise<SearchParams>;
};

async function load(params: Props["params"]) {
  const { storeId, path } = await params;
  const { store } = await getStorefront(storeId);
  const category = await getCategory(store.id, path.map(decodeURIComponent).join("/"));
  if (!category) notFound();
  return { store, category };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, category } = await load(params);
  return {
    title: { absolute: `${category.seo_title ?? category.name} · ${store.name}` },
    ...(category.seo_description ? { description: category.seo_description } : {}),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { store, category } = await load(params);
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Inicio", href: "/" },
          ...category.breadcrumb.map((c) => ({ label: c.name, href: `/categoria/${c.path}` })),
        ]}
      />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{category.name}</h1>
        {category.description ? (
          <p className="max-w-prose text-[var(--sf-muted)]">{category.description}</p>
        ) : null}
      </header>
      {category.children.length > 0 ? (
        <nav aria-label="Subcategorías">
          <ul className="flex flex-wrap gap-2 text-sm">
            {category.children.map((child) => (
              <li key={child.path}>
                <Link
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
