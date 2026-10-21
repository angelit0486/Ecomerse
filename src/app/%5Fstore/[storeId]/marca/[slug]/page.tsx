import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { brandInitialsOf } from "@/lib/catalog/brand-initials";
import { getBrand, mediaUrl } from "@/server/storefront/catalog";
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
    description: brand.seo_description ?? brand.description?.slice(0, 300) ?? undefined,
    image: brand.cover ?? brand.logo,
  });
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { store, brand } = await load(params);
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Inicio", href: "/" }, { label: brand.name }]} />
      {brand.cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada servida por Storage
        <img
          src={mediaUrl(brand.cover.path)}
          alt={brand.cover.alt ?? ""}
          width={brand.cover.width ?? 1600}
          height={brand.cover.height ?? 600}
          fetchPriority="high"
          className="aspect-[8/3] w-full rounded-[var(--sf-radius-card)] object-cover"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado
          <img
            src={mediaUrl(brand.logo.path)}
            alt=""
            width={brand.logo.width ?? 96}
            height={brand.logo.height ?? 96}
            className="size-16 shrink-0 rounded-[var(--sf-radius-control)] bg-[var(--sf-bg)] object-contain sm:size-20"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)] text-xl font-bold sm:size-20"
          >
            {brandInitialsOf(brand.name)}
          </span>
        )}
        <h1 className="min-w-0 text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          {brand.name}
        </h1>
      </div>
      {brand.description || brand.website_url ? (
        <div className="max-w-prose space-y-2">
          {brand.description ? (
            // Texto plano escapado por React; respeta los saltos de línea.
            <p className="whitespace-pre-line text-[var(--sf-muted)]">{brand.description}</p>
          ) : null}
          {brand.website_url ? (
            <a
              href={brand.website_url}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
            >
              Sitio de {brand.name}
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          ) : null}
        </div>
      ) : null}
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
