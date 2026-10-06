import type { Metadata } from "next";

import { getStorefront } from "@/server/storefront/context";

import { ProductListing, type SearchParams } from "../_components/listing";

type Props = { params: Promise<{ storeId: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store } = await getStorefront((await params).storeId);
  return { title: { absolute: `Productos · ${store.name}` } };
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
