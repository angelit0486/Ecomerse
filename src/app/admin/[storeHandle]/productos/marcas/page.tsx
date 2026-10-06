import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listBrands } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { BrandForm, DeleteBrandButton } from "../catalog-forms";

export const metadata: Metadata = { title: "Marcas" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function BrandsPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "brands.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const brands = await listBrands(supabase, ctx.store.id);

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/${ctx.store.handle}/productos`} className="text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Marcas</h1>
        <p className="text-sm text-fg-muted">
          Las marcas que vendes. Eliminar una marca no borra sus productos.
        </p>
      </header>
      <BrandForm storeHandle={ctx.store.handle} />
      {brands.length === 0 ? (
        <EmptyState
          title="Aún no tienes marcas"
          description="Agrega las marcas de tus productos para filtrarlas en la tienda."
        />
      ) : (
        <ul aria-label="Marcas" className="space-y-3">
          {brands.map((brand) => (
            <li
              key={brand.id}
              className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
            >
              <BrandForm storeHandle={ctx.store.handle} brand={brand} />
              <DeleteBrandButton storeHandle={ctx.store.handle} id={brand.id} name={brand.name} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
