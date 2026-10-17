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
          <input
            id={id}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            className="h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3"
          />
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
                    className="h-10 w-16 shrink-0 object-contain"
                  />
                ) : null}
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
