import type { Metadata } from "next";

import { getStorefront } from "@/server/storefront/context";
import { pageMetadata } from "@/server/storefront/seo";

import { ProductListing, type SearchParams } from "../_components/listing";

type Props = { params: Promise<{ storeId: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview } = await getStorefront((await params).storeId);
  // Los resultados de búsqueda no se indexan (§24).
  return {
    ...pageMetadata({ store, preview, path: "/buscar", title: "Buscar" }),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
        {query ? `Resultados para «${query}»` : "Buscar"}
      </h1>
      {query ? (
        <ProductListing
          store={store}
          basePath="/buscar"
          searchParams={sp}
          query={query}
          emptyTitle="Sin resultados"
          emptyText="Revisa la ortografía o prueba con otras palabras."
        />
      ) : (
        <p className="text-[var(--sf-muted)]">Escribe lo que buscas en la caja de búsqueda.</p>
      )}
    </div>
  );
}
