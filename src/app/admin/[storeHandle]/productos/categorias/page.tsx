import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listCategories, listCategoryImages } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";
import {
  SUPPLEMENT_CATEGORIES,
  missingSupplementCategories,
} from "@/lib/catalog/supplement-taxonomy";
import { brandInitialsOf } from "@/lib/catalog/brand-initials";
import { EmptyState } from "@/ui/primitives/empty-state";

import { BulkEntityImages, EntityImageField } from "../_media/entity-images";

import { CategoryForm, DeleteCategoryButton, SupplementCategoriesButton } from "../catalog-forms";

export const metadata: Metadata = { title: "Categorías" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function CategoriesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "categories.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const [categories, images] = await Promise.all([
    listCategories(supabase, ctx.store.id),
    listCategoryImages(supabase, ctx.store.id),
  ]);
  const withoutImage = categories.filter((c) => !images.get(c.id)?.image).length;
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
        <>
          {withoutImage > 0 ? (
            <p className="text-sm">
              {withoutImage === 1
                ? "1 categoría no tiene foto: en la tienda se ven sus iniciales."
                : `${withoutImage} categorías no tienen foto: en la tienda se ven sus iniciales.`}
            </p>
          ) : null}
          <BulkEntityImages
            storeHandle={ctx.store.handle}
            entity="category"
            items={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
          />
          <ul aria-label="Árbol de categorías" className="space-y-3">
            {categories.map((category) => (
              <li
                key={category.id}
                className="space-y-2 rounded-md border border-border p-3"
                data-depth={category.depth}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {images.get(category.id)?.image?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- foto re-codificada
                    <img
                      src={images.get(category.id)!.image!.url!}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-[11px] font-bold text-fg-muted"
                    >
                      {brandInitialsOf(category.name)}
                    </span>
                  )}
                  {"— ".repeat(category.depth)}
                  {category.name}
                  <span className="ml-2 text-fg-muted">/{category.path}</span>
                  {category.is_visible ? null : (
                    <span className="ml-2 text-fg-muted">(oculta)</span>
                  )}
                </p>
                <CategoryForm
                  storeHandle={ctx.store.handle}
                  categories={options}
                  category={category}
                />
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline md:min-h-0">
                    Fotos de {category.name}
                  </summary>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <EntityImageField
                      storeHandle={ctx.store.handle}
                      entity="category"
                      item={{ id: category.id, name: category.name }}
                      kind="image"
                      current={images.get(category.id)?.image ?? null}
                    />
                    <EntityImageField
                      storeHandle={ctx.store.handle}
                      entity="category"
                      item={{ id: category.id, name: category.name }}
                      kind="cover"
                      current={images.get(category.id)?.cover ?? null}
                    />
                  </div>
                </details>
                <DeleteCategoryButton
                  storeHandle={ctx.store.handle}
                  id={category.id}
                  name={category.name}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
