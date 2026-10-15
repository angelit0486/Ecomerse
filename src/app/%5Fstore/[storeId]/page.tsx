import type { Metadata } from "next";
import Link from "next/link";

import { getHome, mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { canonicalUrl, pageMetadata } from "@/server/storefront/seo";

import { JsonLd } from "./_components/json-ld";
import { ProductGrid } from "./_components/product-card";

/** Inicio de la tienda: categorías y novedades (las secciones configurables llegan en F9). */
type Props = { params: Promise<{ storeId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview } = await getStorefront((await params).storeId);
  return pageMetadata({
    store,
    preview,
    path: "/",
    title: store.name,
  });
}

export default async function StoreHomePage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const home = await getHome(store.id);
  return (
    <div className="space-y-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "OnlineStore",
              name: store.name,
              url: canonicalUrl(store, "/"),
              ...(store.logo ? { logo: mediaUrl(store.logo.path) } : {}),
            },
            {
              "@type": "WebSite",
              name: store.name,
              url: canonicalUrl(store, "/"),
              potentialAction: {
                "@type": "SearchAction",
                target: `${canonicalUrl(store, "/buscar")}?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            },
          ],
        }}
      />
      <h1 className="text-2xl font-semibold sm:text-3xl">{store.name}</h1>
      {home.categories.length > 0 ? (
        <section aria-labelledby="sf-categorias" className="space-y-4">
          <h2 id="sf-categorias" className="text-lg font-semibold">
            Categorías
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {home.categories.map((category) => (
              <li key={category.path}>
                <Link
                  href={`/categoria/${category.path}`}
                  className="flex flex-col gap-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 hover:bg-[var(--sf-surface)]"
                >
                  {category.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagen re-codificada
                    <img
                      src={mediaUrl(category.image.path)}
                      alt=""
                      width={category.image.width ?? 320}
                      height={category.image.height ?? 320}
                      loading="lazy"
                      className="aspect-square w-full rounded object-cover"
                    />
                  ) : null}
                  <span className="font-medium">{category.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="sf-novedades" className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 id="sf-novedades" className="text-lg font-semibold">
            Novedades
          </h2>
          <Link href="/productos" className="text-sm underline underline-offset-4">
            Ver todo
          </Link>
        </div>
        {home.featured.length > 0 ? (
          <ProductGrid products={home.featured} store={store} eager={4} />
        ) : (
          <p className="text-[var(--sf-muted)]">Muy pronto encontrarás aquí nuestros productos.</p>
        )}
      </section>
    </div>
  );
}
