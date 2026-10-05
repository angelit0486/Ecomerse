import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { serverEnv } from "@/server/env";
import { STORE_ROUTE_HEADER, verifyStoreRoute } from "@/server/storefront/route-signature";
import { getStorePublic } from "@/server/storefront/store-public";
import { EmptyState } from "@/ui/primitives/empty-state";

/**
 * Inicio de la tienda (host de tienda → proxy → /_store/{storeId}). Fase 2: solo
 * prueba la resolución de host de punta a punta; el storefront real llega en la
 * Fase 5.
 */
type Props = { params: Promise<{ storeId: string }> };

/** Tienda verificada para este request, o null (404). */
async function verifiedStore(storeId: string) {
  // Solo requests enrutados por el proxy para ESTA tienda (firma HMAC).
  const route = verifyStoreRoute(
    serverEnv().PREVIEW_HMAC_SECRET,
    storeId,
    (await headers()).get(STORE_ROUTE_HEADER),
  );
  if (!route) return null;
  const store = await getStorePublic(storeId);
  // Segunda comprobación del estado: borrador solo con vista previa.
  if (!store || (store.status !== "active" && !(store.status === "draft" && route.preview))) {
    return null;
  }
  return { store, preview: route.preview };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const verified = await verifiedStore((await params).storeId);
  return { title: { absolute: verified?.store.name ?? "Tienda" } };
}

export default async function StoreHomePage({ params }: Props) {
  const verified = await verifiedStore((await params).storeId);
  if (!verified) notFound();
  const { store, preview } = verified;
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
