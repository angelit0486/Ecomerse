import Link from "next/link";

import type { Facet } from "@/server/storefront/catalog";

/**
 * Filtros por atributo con conteo (R-T04, ADR-022). Formulario GET: funciona sin
 * JavaScript y cada combinación tiene su URL. El conteo de un valor dice cuántos
 * productos habría al marcarlo.
 */
export function FacetFilters({
  action,
  facets,
  hidden,
  clearHref,
}: {
  action: string;
  facets: Facet[];
  /** Orden, disponibilidad y búsqueda: se conservan al filtrar. */
  hidden: [string, string][];
  clearHref: string | null;
}) {
  return (
    <form method="get" action={action} aria-label="Filtros" className="space-y-4 text-sm">
      {hidden.map(([name, value]) => (
        <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
      ))}
      {facets.map((facet) => (
        <fieldset key={facet.key} className="space-y-1">
          <legend className="font-semibold">{facet.name}</legend>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 md:block md:space-y-1">
            {facet.values.map((value) => (
              <li key={value.key}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={facet.key}
                    value={value.key}
                    defaultChecked={value.selected}
                    aria-label={`${value.label} (${value.count} ${value.count === 1 ? "producto" : "productos"})`}
                  />
                  <span>
                    {value.label} <span className="text-[var(--sf-muted)]">({value.count})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="h-10 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] px-4 font-medium"
        >
          Filtrar
        </button>
        {clearHref ? (
          <Link href={clearHref} className="underline">
            Quitar filtros
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** Filtros activos, cada uno con su enlace para quitarlo. */
export function ActiveFilters({
  items,
}: {
  items: { label: string; facet: string; href: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Filtros activos">
      <ul className="flex flex-wrap gap-2 text-sm">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-label={`Quitar el filtro ${item.facet}: ${item.label}`}
              className="inline-flex items-center gap-1 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border)] px-3 py-1 hover:bg-[var(--sf-surface)]"
            >
              {item.label}
              <span aria-hidden="true">×</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
