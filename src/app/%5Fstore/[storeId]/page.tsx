import type { Metadata } from "next";
import Link from "next/link";

import { getHome, mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { getHomePreview } from "@/server/storefront/preview-reads";
import { canonicalUrl, pageMetadata } from "@/server/storefront/seo";

import { HomeSections } from "./_components/home-sections";
import { JsonLd } from "./_components/json-ld";
import { ProductGrid } from "./_components/product-card";

/**
 * Inicio de la tienda (§20.2, F9-T02): las secciones que configuró la tienda
 * (del borrador en la vista previa) o, sin ellas, la plantilla del tema.
 */
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
  const { store, preview } = await getStorefront((await params).storeId);
  const home = preview ? await getHomePreview(store.id) : await getHome(store.id);
  const sections = home.sections ?? [];
  const categories = home.categories ?? [];
  const featured = home.featured ?? [];
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
      {home.sections ? (
        <HomeSections sections={sections} store={store} storeName={store.name} />
      ) : (
        <TemplateHome store={store} categories={categories} featured={featured} />
      )}
    </div>
  );
}

/** Plantilla del tema (§20.2): el nombre, las categorías raíz y las novedades. */
function TemplateHome({
  store,
  categories,
  featured,
}: {
  store: { name: string; currency: string; locale: string };
  categories: NonNullable<Awaited<ReturnType<typeof getHome>>["categories"]>;
  featured: NonNullable<Awaited<ReturnType<typeof getHome>>["featured"]>;
}) {
  return (
    <div className="space-y-12">
      <h1 className="text-2xl font-semibold sm:text-3xl">{store.name}</h1>
      {categories.length > 0 ? (
        <section aria-labelledby="sf-categorias" className="space-y-4">
          <h2 id="sf-categorias" className="text-lg font-semibold">
            Categorías
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {categories.map((category) => (
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
        {featured.length > 0 ? (
          <ProductGrid products={featured} store={store} eager={4} />
        ) : (
          <p className="text-[var(--sf-muted)]">Muy pronto encontrarás aquí nuestros productos.</p>
        )}
      </section>
    </div>
  );
}
