import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { servingsByContent, type ProductTemplate } from "@/lib/catalog/suggest";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listBrands, listCategories } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { toEditorProduct } from "../editor-model";
import { ProductEditor } from "../product-editor";
import { QuickProductForm } from "./quick-product-form";

export const metadata: Metadata = { title: "Nuevo producto" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Alta de producto. Por defecto el alta rápida (misión panel, Fase 1); con
 * `?completo=1`, el editor completo para crear con varias presentaciones.
 */
export default async function NewProductPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.create")) notFound();
  const full = (await searchParams).completo === "1";
  const supabase = await createSupabaseServerClient();
  const base = `/admin/${ctx.store.handle}/productos`;
  const [brands, categories, contents] = await Promise.all([
    listBrands(supabase, ctx.store.id),
    listCategories(supabase, ctx.store.id),
    full
      ? Promise.resolve({ data: [] })
      : supabase
          .from("product_variants")
          .select("net_content, servings_per_container")
          .eq("store_id", ctx.store.id)
          .is("deleted_at", null)
          .not("net_content", "is", null)
          .limit(500),
  ]);
  const contentRows = (contents.data ?? []) as {
    net_content: string;
    servings_per_container: number | null;
  }[];
  const netContents = [...new Set(contentRows.map((r) => r.net_content))]
    .sort((a, b) => a.localeCompare(b, "es"))
    .slice(0, 50);
  // Si la tienda ya captura contenido neto, lo más probable es que venda suplementos.
  const defaultTemplate: ProductTemplate = netContents.length > 0 ? "supplement" : "general";

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <Link href={base} className="inline-flex min-h-11 items-center text-sm underline">
          ← Productos
        </Link>
        <h1 className="text-xl font-semibold">Nuevo producto</h1>
        {full ? (
          <p className="text-sm text-fg-muted">
            Formulario completo: presentaciones, datos para buscadores y más. Se guarda como
            borrador.{" "}
            <Link href={`${base}/nuevo`} className="underline">
              Volver al alta rápida
            </Link>
          </p>
        ) : (
          <p className="text-sm text-fg-muted">
            Lo básico para empezar a vender.{" "}
            <Link href={`${base}/nuevo?completo=1`} className="underline">
              Formulario completo (con sabores, tallas o tamaños)
            </Link>
          </p>
        )}
      </header>
      {full ? (
        <ProductEditor
          storeHandle={ctx.store.handle}
          initial={toEditorProduct(null)}
          brands={brands}
          categories={categories}
          canReadCost={hasPermission(ctx, "products.cost.read")}
          currency={ctx.store.currency}
        />
      ) : (
        <QuickProductForm
          storeHandle={ctx.store.handle}
          brands={brands}
          categories={categories.map((c) => ({ id: c.id, name: c.name, depth: c.depth }))}
          netContents={netContents}
          servingsHint={servingsByContent(contentRows)}
          defaultTemplate={defaultTemplate}
          canStock={hasPermission(ctx, "inventory.adjust")}
          canReadCost={hasPermission(ctx, "products.cost.read")}
        />
      )}
    </section>
  );
}
