import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listCategories } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  SUPPLEMENT_CATEGORIES,
  missingSupplementCategories,
} from "@/lib/catalog/supplement-taxonomy";
import { EmptyState } from "@/ui/primitives/empty-state";

import { CategoryForm, DeleteCategoryButton, SupplementCategoriesButton } from "../catalog-forms";

export const metadata: Metadata = { title: "Categorías" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function CategoriesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "categories.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const categories = await listCategories(supabase, ctx.store.id);
  const options = categories.map((c) => ({ id: c.id, name: c.name, depth: c.depth }));
  const missing = missingSupplementCategories(categories);
  // Se sugiere a una tienda sin categorías o que ya empezó esta estructura; una
  // tienda de otro giro con su propio catálogo no la ve (marca blanca).
  const suggested =
    categories.length === 0 || missing.length < SUPPLEMENT_CATEGORIES.length ? missing : [];

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/productos`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Categorías</h1>
        <p className="text-sm text-fg-muted">
          Organizan tu catálogo y el menú de la tienda. Hasta 4 niveles; para mover una categoría
          cambia «Dentro de».
        </p>
      </header>
      {suggested.length > 0 ? (
        <section
          aria-labelledby="estructura-sugerida"
          className="space-y-3 rounded-md border border-border p-4"
        >
          <h2 id="estructura-sugerida" className="text-base font-semibold">
            ¿Vendes suplementos? Estructura sugerida
          </h2>
          <p className="text-sm text-fg-muted">
            Las categorías que esperan encontrar tus clientes. Se crean visibles y vacías; después
            puedes renombrarlas, ocultarlas o agregar subcategorías.
          </p>
          <ul aria-label="Categorías por crear" className="flex flex-wrap gap-2">
            {suggested.map((c) => (
              <li key={c.slug} className="rounded-full border border-border px-3 py-1 text-sm">
                {c.name}
              </li>
            ))}
          </ul>
          <SupplementCategoriesButton storeHandle={ctx.store.handle} count={suggested.length} />
        </section>
      ) : null}
      <section aria-labelledby="nueva-categoria" className="space-y-3">
        <h2 id="nueva-categoria" className="text-base font-semibold">
          Nueva categoría
        </h2>
        <CategoryForm storeHandle={ctx.store.handle} categories={options} />
      </section>
      {categories.length === 0 ? (
        <EmptyState
          title="Aún no tienes categorías"
          description="Crea categorías como «Ropa» o «Accesorios» para que tus clientes encuentren los productos."
        />
      ) : (
        <ul aria-label="Árbol de categorías" className="space-y-3">
          {categories.map((category) => (
            <li
              key={category.id}
              className="space-y-2 rounded-md border border-border p-3"
              data-depth={category.depth}
            >
              <p className="text-sm font-medium">
                {"— ".repeat(category.depth)}
                {category.name}
                <span className="ml-2 text-fg-muted">/{category.path}</span>
                {category.is_visible ? null : <span className="ml-2 text-fg-muted">(oculta)</span>}
              </p>
              <CategoryForm
                storeHandle={ctx.store.handle}
                categories={options}
                category={category}
              />
              <DeleteCategoryButton
                storeHandle={ctx.store.handle}
                id={category.id}
                name={category.name}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
