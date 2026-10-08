import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listAttributes } from "@/server/catalog/attributes";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AttributeForm, DeleteAttributeForm } from "../attribute-forms";

export const metadata: Metadata = { title: "Atributos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Atributos filtrables (R-T04, ADR-022): taxonomía del catálogo, con categories.manage. */
export default async function AttributesPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "categories.manage")) notFound();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const attributes = await listAttributes(supabase, ctx.store.id);

  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/${ctx.store.handle}/productos`} className="text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Atributos</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          Características con las que tus clientes filtran el catálogo, como el objetivo o el sabor.
          Asígnalos en cada producto. Hasta 20 atributos con 50 valores cada uno.
        </p>
        {sp.guardado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Atributo guardado.
          </p>
        ) : null}
        {sp.eliminado === "1" ? (
          <p role="status" className="mt-2 text-sm text-success">
            Atributo eliminado. Sus productos ya no lo llevan.
          </p>
        ) : null}
      </header>

      {attributes.length < 20 ? (
        // Se rehace al crear uno: vuelve vacío.
        <AttributeForm key={`new:${attributes.length}`} storeHandle={ctx.store.handle} />
      ) : null}

      {attributes.length > 0 ? (
        <ul aria-label="Atributos" className="space-y-4">
          {attributes.map((attribute) => (
            <li key={attribute.id} className="space-y-2">
              <AttributeForm
                // Con datos nuevos (ids de valores creados, nombres) el formulario se rehace.
                key={`${attribute.id}:${attribute.name}:${attribute.values.map((v) => `${v.id}=${v.label}`).join("|")}`}
                storeHandle={ctx.store.handle}
                attribute={{
                  id: attribute.id,
                  key: attribute.key,
                  name: attribute.name,
                  is_filterable: attribute.is_filterable,
                  values: attribute.values.map((v) => ({
                    id: v.id,
                    label: v.label,
                    products: v.products,
                  })),
                }}
              />
              <DeleteAttributeForm
                storeHandle={ctx.store.handle}
                id={attribute.id}
                name={attribute.name}
                products={attribute.products}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
