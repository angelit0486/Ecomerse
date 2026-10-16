import Link from "next/link";

import type { PriceFilter } from "@/lib/catalog/price-filter";
import type { Facet } from "@/server/storefront/catalog";

import { AutoSubmitForm, NoJsSubmit } from "./auto-submit";

/**
 * Filtros por atributo con conteo (R-T04, ADR-022). Formulario GET: cada
 * combinación tiene su URL; con JavaScript se aplica al marcar (revisión de
 * conversión, M6) y sin él, con «Filtrar». El conteo de un valor dice cuántos
 * productos habría al marcarlo. Filas de al menos 44 px.
 */
export function FacetFilters({
  action,
  facets,
  hidden,
  clearHref,
  price,
  showOnSale,
}: {
  action: string;
  facets: Facet[];
  /** Rango de precio (pesos) y ofertas reales (super prompt §7). */
  price: PriceFilter;
  /** «Solo ofertas» solo si la tienda tiene alguna. */
  showOnSale: boolean;
  /** Orden, disponibilidad y búsqueda: se conservan al filtrar. */
  hidden: [string, string][];
  clearHref: string | null;
}) {
  return (
    <AutoSubmitForm action={action} aria-label="Filtros" className="space-y-4 text-sm">
      {hidden.map(([name, value]) => (
        <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
      ))}
      <fieldset className="space-y-2">
        <legend className="font-semibold">Precio</legend>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[var(--sf-muted)]">Mínimo</span>
            <input
              type="number"
              name="precio_min"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="$0"
              defaultValue={price.min ?? ""}
              className="sf-qty h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-2"
            />
          </label>
          <span aria-hidden="true" className="pb-3">
            –
          </span>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[var(--sf-muted)]">Máximo</span>
            <input
              type="number"
              name="precio_max"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="Sin límite"
              defaultValue={price.max ?? ""}
              className="sf-qty h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-2"
            />
          </label>
        </div>
        <button
          type="submit"
          className="h-11 w-full rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] px-4 font-medium"
        >
          Aplicar precio
        </button>
        {showOnSale ? (
          <label className="flex min-h-11 items-center gap-2 md:min-h-9">
            <input
              type="checkbox"
              name="oferta"
              value="1"
              defaultChecked={price.onSale}
              className="h-5 w-5 shrink-0 accent-[var(--sf-primary)]"
            />
            <span>Solo ofertas</span>
          </label>
        ) : null}
      </fieldset>
      {facets.map((facet) => (
        <fieldset key={facet.key} className="space-y-1">
          <legend className="font-semibold">{facet.name}</legend>
          <ul className="grid grid-cols-2 gap-x-4 md:block">
            {facet.values.map((value) => (
              <li key={value.key}>
                <label className="flex min-h-11 items-center gap-2 md:min-h-9">
                  <input
                    type="checkbox"
                    name={facet.key}
                    value={value.key}
                    defaultChecked={value.selected}
                    className="h-5 w-5 shrink-0 accent-[var(--sf-primary)]"
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
        <NoJsSubmit className="h-10 rounded-[var(--sf-radius-control)] border border-[var(--sf-border)] px-4 font-medium">
          Filtrar
        </NoJsSubmit>
        {clearHref ? (
          <Link href={clearHref} className="inline-flex min-h-11 items-center underline">
            Quitar filtros
          </Link>
        ) : null}
      </div>
    </AutoSubmitForm>
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
              className="inline-flex min-h-11 items-center gap-1 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border)] px-3 hover:bg-[var(--sf-surface)]"
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
