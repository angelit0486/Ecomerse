"use client";

import Link from "next/link";
import { useId, useState } from "react";

interface Brand {
  slug: string;
  name: string;
  count: number;
  logo: { src: string; width: number | null; height: number | null } | null;
}

/** Sin acentos ni mayúsculas, como la búsqueda de la tienda. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Hasta dos iniciales del nombre de la marca («Muha Meds» → «MM»). */
export function brandInitials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

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
        // Índice tipográfico (como «Compra por categoría»): nombre grande, logo si
        // existe y el conteo alineado a la derecha.
        <ul className="grid border-t border-[var(--sf-fg)] sm:grid-cols-2 sm:gap-x-10">
          {shown.map((brand) => (
            <li key={brand.slug} className="border-b border-[var(--sf-border)]">
              <Link
                href={`/marca/${brand.slug}`}
                className="group flex min-h-16 items-center gap-4 py-3"
              >
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
                  <img
                    src={brand.logo.src}
                    alt=""
                    width={brand.logo.width ?? undefined}
                    height={brand.logo.height ?? undefined}
                    loading="lazy"
                    className="size-12 shrink-0 rounded-[var(--sf-radius-control)] object-contain"
                  />
                ) : (
                  // Sin logo: las iniciales (Paso 2), para que la lista no quede dispareja.
                  <span
                    aria-hidden="true"
                    className="flex size-12 shrink-0 items-center justify-center rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)] text-base font-bold text-[var(--sf-fg)]"
                  >
                    {brandInitials(brand.name)}
                  </span>
                )}
                <span className="text-xl font-medium tracking-tight decoration-1 underline-offset-[6px] group-hover:underline sm:text-2xl">
                  {brand.name}
                </span>
                <span className="ml-auto shrink-0 text-sm tabular-nums text-[var(--sf-muted)]">
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
