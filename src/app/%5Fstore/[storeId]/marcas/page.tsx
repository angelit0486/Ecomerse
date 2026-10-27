import type { Metadata } from "next";
import Link from "next/link";

import { listBrands, mediaUrl } from "@/server/storefront/catalog";
import { getStorefront } from "@/server/storefront/context";
import { pageMetadata } from "@/server/storefront/seo";

import { Breadcrumb } from "../_components/breadcrumb";
import { BrandFilter } from "./brand-filter";

type Props = { params: Promise<{ storeId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store, preview } = await getStorefront((await params).storeId);
  return pageMetadata({ store, preview, path: "/marcas", title: "Marcas" });
}

/**
 * Directorio de marcas (super prompt §8): solo marcas con productos publicados,
 * desde la fuente principal; cada una lleva a su página con filtros y orden.
 * El buscador filtra la lista en el navegador; sin JavaScript se ven todas.
 */
export default async function BrandsPage({ params }: Props) {
  const { store } = await getStorefront((await params).storeId);
  const brands = await listBrands(store.id);
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Inicio", href: "/" }, { label: "Marcas" }]} />
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          Marcas
        </h1>
        <p className="text-sm text-[var(--sf-muted)]">
          {brands.length === 1 ? "1 marca" : `${brands.length} marcas`} con productos en la tienda.
        </p>
      </header>
      {brands.length === 0 ? (
        <section className="rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-6">
          <h2 className="font-semibold">Aún no hay marcas</h2>
          <p className="mt-1 text-sm text-[var(--sf-muted)]">
            <Link prefetch={false} href="/productos" className="underline">
              Ver todos los productos
            </Link>
          </p>
        </section>
      ) : (
        <BrandFilter
          brands={brands.map((b) => ({
            slug: b.slug,
            name: b.name,
            count: b.count,
            logo: b.logo
              ? { src: mediaUrl(b.logo.path), width: b.logo.width, height: b.logo.height }
              : null,
          }))}
          searchable={brands.length > 8}
        />
      )}
    </div>
  );
}
