import type { Metadata } from "next";

import { getStorefront } from "@/server/storefront/context";
import { pageMetadata } from "@/server/storefront/seo";

import { ProductListing, type SearchParams } from "../_components/listing";

type Props = { params: Promise<{ storeId: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { store, preview } = await getStorefront((await params).storeId);
  const desde = (await searchParams).desde;
  // Orden y filtros canonicalizan a la URL limpia; la paginación, a sí misma (§24).
  const path =
    typeof desde === "string" ? `/productos?desde=${encodeURIComponent(desde)}` : "/productos";
  return pageMetadata({ store, preview, path, title: "Productos" });
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { store } = await getStorefront((await params).storeId);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Productos</h1>
      <ProductListing
        store={store}
        basePath="/productos"
        searchParams={await searchParams}
        emptyTitle="No hay productos"
        emptyText="Prueba con otros filtros o vuelve más tarde."
      />
    </div>
  );
}
