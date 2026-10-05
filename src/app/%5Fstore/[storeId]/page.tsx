import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getStorePublic } from "@/server/storefront/store-public";
import { EmptyState } from "@/ui/primitives/empty-state";

/**
 * Inicio de la tienda (host de tienda → proxy → /_store/{storeId}). Fase 2: solo
 * prueba la resolución de host de punta a punta; el storefront real llega en la
 * Fase 5.
 */
type Props = { params: Promise<{ storeId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await getStorePublic((await params).storeId);
  return { title: { absolute: store?.name ?? "Tienda" } };
}

export default async function StoreHomePage({ params }: Props) {
  const store = await getStorePublic((await params).storeId);
  if (!store) notFound();
  const preview = (await headers()).get("x-store-preview") === "1";
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      {preview ? (
        <p role="status" className="mb-6 rounded-md border px-3 py-2 text-sm">
          Vista previa: solo tú puedes ver esta tienda.
        </p>
      ) : null}
      <EmptyState
        title={store.name}
        description="Muy pronto encontrarás aquí nuestros productos."
      />
    </main>
  );
}
