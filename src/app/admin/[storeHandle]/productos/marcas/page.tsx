import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { brandInitialsOf } from "@/lib/catalog/brand-initials";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listBrandProfiles } from "@/server/catalog/queries";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { BrandForm, DeleteBrandButton } from "../catalog-forms";
import { BulkEntityImages, EntityImageField } from "../_media/entity-images";
import { BrandProfileForm } from "./brand-profile-form";

export const metadata: Metadata = { title: "Marcas" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Marcas con logo, portada, descripción y sitio (misión Portada/Marcas, Paso 2).
 * Cada marca se edita en su tarjeta; los logos de varias marcas se suben de
 * una vez arriba.
 */
export default async function BrandsPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "brands.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const brands = await listBrandProfiles(supabase, ctx.store.id);
  const withoutLogo = brands.filter((b) => !b.logo).length;

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/productos`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Marcas</h1>
        <p className="text-sm text-fg-muted">
          Las marcas que vendes, con su logo para el directorio y la portada de tu tienda. Eliminar
          una marca no borra sus productos.
        </p>
      </header>
      <BrandForm storeHandle={ctx.store.handle} />
      {brands.length === 0 ? (
        <EmptyState
          title="Aún no tienes marcas"
          description="Agrega las marcas de tus productos para filtrarlas en la tienda y mostrar sus logos."
        />
      ) : (
        <>
          {withoutLogo > 0 ? (
            <p className="text-sm">
              {withoutLogo === 1
                ? "1 marca no tiene logo: en la tienda se ven sus iniciales."
                : `${withoutLogo} marcas no tienen logo: en la tienda se ven sus iniciales.`}
            </p>
          ) : null}
          <BulkEntityImages
            storeHandle={ctx.store.handle}
            entity="brand"
            items={brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug }))}
          />
          <ul aria-label="Marcas" className="space-y-3">
            {brands.map((brand) => (
              <li key={brand.id} className="rounded-md border border-border">
                <details>
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                    {brand.logo?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado
                      <img
                        src={brand.logo.url}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 shrink-0 rounded object-contain"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded bg-canvas text-sm font-bold text-fg-muted"
                      >
                        {brandInitialsOf(brand.name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{brand.name}</span>
                    <span className="shrink-0 text-[13px] text-fg-muted">
                      {brand.logo
                        ? brand.logo.status === "pending"
                          ? "Logo procesándose"
                          : brand.logo.status === "rejected"
                            ? "Logo rechazado"
                            : "Con logo"
                        : "Sin logo"}
                    </span>
                    <span className="shrink-0 text-sm font-medium underline">Editar</span>
                  </summary>
                  <div className="space-y-4 border-t border-border p-3">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <EntityImageField
                        storeHandle={ctx.store.handle}
                        entity="brand"
                        item={{ id: brand.id, name: brand.name }}
                        kind="logo"
                        current={brand.logo}
                      />
                      <EntityImageField
                        storeHandle={ctx.store.handle}
                        entity="brand"
                        item={{ id: brand.id, name: brand.name }}
                        kind="cover"
                        current={brand.cover}
                      />
                    </div>
                    <BrandProfileForm storeHandle={ctx.store.handle} brand={brand} />
                    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                      <Link
                        href={`/admin/${ctx.store.handle}/productos?marca=${brand.id}`}
                        className="inline-flex min-h-11 items-center text-sm underline"
                      >
                        Ver sus productos
                      </Link>
                      <DeleteBrandButton
                        storeHandle={ctx.store.handle}
                        id={brand.id}
                        name={brand.name}
                      />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
