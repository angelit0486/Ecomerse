import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getBrand } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { pageMetadata } from "@/server/storefront/seo";

import { Breadcrumb } from "../../_components/breadcrumb";
import { ProductListing, type SearchParams } from "../../_components/listing";

type Props = {
  params: Promise<{ storeId: string; slug: string }>;
  searchParams: Promise<SearchParams>;
};

async function load(params: Props["params"]) {
  const { storeId, slug } = await params;
  const { store, preview } = await getStorefront(storeId);
  const brand = await getBrand(store.id, slug);
  if (!brand) notFound();
  return { store, preview, brand };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview, brand } = await load(params);
  return pageMetadata({
    store,
    preview,
    path: `/marca/${brand.slug}`,
    title: brand.seo_title ?? brand.name,
    description: brand.seo_description ?? undefined,
    image: brand.logo,
  });
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { store, brand } = await load(params);
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Inicio", href: "/" }, { label: brand.name }]} />
      <h1 className="text-2xl font-semibold">{brand.name}</h1>
      <ProductListing
        store={store}
        basePath={`/marca/${brand.slug}`}
        searchParams={await searchParams}
        brandSlug={brand.slug}
        emptyTitle="Aún no hay productos de esta marca"
        emptyText="Vuelve pronto o explora el resto del catálogo."
      />
    </div>
  );
}
