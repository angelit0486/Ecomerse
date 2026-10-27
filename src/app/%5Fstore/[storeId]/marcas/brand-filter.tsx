"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { brandInitialsOf } from "@/lib/catalog/brand-initials";

interface Brand {
  slug: string;
  name: string;
  count: number;
  logo: { src: string; width: number | null; height: number | null } | null;
}

/** Sin acentos ni mayúsculas, como la búsqueda de la tienda. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Hasta dos iniciales (se exporta también para las pruebas). */
export const brandInitials = brandInitialsOf;

/** Lista de marcas con búsqueda por nombre (solo cuando son muchas). */
export function BrandFilter({ brands, searchable }: { brands: Brand[]; searchable: boolean }) {
  const [q, setQ] = useState("");
  const id = useId();
  const shown = q ? brands.filter((b) => fold(b.name).includes(fold(q))) : brands;
  return (
    <div className="space-y-4">
      {searchable ? (
        <div className="max-w-sm space-y-1">
          <label htmlFor={id} className="block text-sm font-medium">
            Buscar marca
          </label>
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[var(--sf-muted)]"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id={id}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
              placeholder="Escribe el nombre de una marca"
              className="h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] pl-10 pr-3 placeholder:text-[var(--sf-muted)]"
            />
          </div>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {q ? `${shown.length} marcas` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm">Ninguna marca coincide con «{q}».</p>
      ) : (
        // Cuadrícula de logos (misión Portada/Marcas): logo o iniciales, nombre y conteo.
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.map((brand) => (
            <li key={brand.slug}>
              <Link
                prefetch={false}
                href={`/marca/${brand.slug}`}
                className="group flex h-full flex-col gap-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-3 hover:border-[var(--sf-fg)]"
              >
                <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)]">
                  {brand.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
                    <img
                      src={brand.logo.src}
                      alt=""
                      width={brand.logo.width ?? undefined}
                      height={brand.logo.height ?? undefined}
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  ) : (
                    // Sin logo: las iniciales, para que la cuadrícula no quede dispareja.
                    <span aria-hidden="true" className="text-3xl font-bold text-[var(--sf-fg)]">
                      {brandInitials(brand.name)}
                    </span>
                  )}
                </span>
                <span className="font-semibold leading-tight decoration-1 underline-offset-4 group-hover:underline">
                  {brand.name}
                </span>
                <span className="text-sm tabular-nums text-[var(--sf-muted)]">
                  {brand.count === 1 ? "1 producto" : `${brand.count} productos`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
