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
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((brand) => (
            <li key={brand.slug}>
              <Link
                href={`/marca/${brand.slug}`}
                className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-4 text-center hover:border-[var(--sf-border-strong)]"
              >
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo re-codificado servido por Storage
                  <img
                    src={brand.logo.src}
                    alt=""
                    width={brand.logo.width ?? undefined}
                    height={brand.logo.height ?? undefined}
                    loading="lazy"
                    className="max-h-12 w-auto object-contain"
                  />
                ) : null}
                <span className="font-semibold">{brand.name}</span>
                <span className="text-sm text-[var(--sf-muted)]">
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
