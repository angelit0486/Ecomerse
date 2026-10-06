import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listBrands, listCategories } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { toEditorProduct } from "../editor-model";
import { ProductEditor } from "../product-editor";

export const metadata: Metadata = { title: "Nuevo producto" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function NewProductPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.create")) notFound();
  const supabase = await createSupabaseServerClient();
  const [brands, categories] = await Promise.all([
    listBrands(supabase, ctx.store.id),
    listCategories(supabase, ctx.store.id),
  ]);
  return (
    <section className="space-y-5">
      <header>
        <Link href={`/admin/${ctx.store.handle}/productos`} className="text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Nuevo producto</h1>
        <p className="text-sm text-fg-muted">
          Se guarda como borrador. Podrás agregar imágenes y publicarlo después de crearlo.
        </p>
      </header>
      <ProductEditor
        storeHandle={ctx.store.handle}
        initial={toEditorProduct(null)}
        brands={brands}
        categories={categories}
        canReadCost={hasPermission(ctx, "products.cost.read")}
        currency={ctx.store.currency}
      />
    </section>
  );
}
