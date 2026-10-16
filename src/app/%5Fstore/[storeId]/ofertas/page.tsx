import type { Metadata } from "next";

import { getStorefront } from "@/server/storefront/context";
import { pageMetadata } from "@/server/storefront/seo";

import { Breadcrumb } from "../_components/breadcrumb";
import { ProductListing, type SearchParams } from "../_components/listing";

type Props = { params: Promise<{ storeId: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { store, preview } = await getStorefront((await params).storeId);
  const desde = (await searchParams).desde;
  // Filtros canonicalizan a la URL limpia; la paginación, a sí misma (§24).
  const path =
    typeof desde === "string" ? `/ofertas?desde=${encodeURIComponent(desde)}` : "/ofertas";
  return pageMetadata({ store, preview, path, title: "Ofertas" });
}

/**
 * Ofertas (super prompt §5): solo productos con descuento real, es decir, con una
 * variante activa cuyo precio de comparación es mayor que su precio. Nada se
 * marca como oferta a mano.
 */
export default async function OffersPage({ params, searchParams }: Props) {
  const { store } = await getStorefront((await params).storeId);
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Inicio", href: "/" }, { label: "Ofertas" }]} />
      <ProductListing
        store={store}
        title="Ofertas"
        basePath="/ofertas"
        onlyOffers
        searchParams={await searchParams}
        emptyTitle="Por ahora no hay ofertas"
        emptyText="Cuando un producto tenga descuento, aparecerá aquí."
      />
    </div>
  );
}
