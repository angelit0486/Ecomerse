import Link from "next/link";

import { hasSelection, parseAttributeParams, selectionPairs } from "@/lib/catalog/attributes";
import type { StorePublic } from "@/server/storefront/store-public";
import {
  encodeListCursor,
  LIST_SORTS,
  listFacets,
  listProducts,
  type ListSort,
} from "@/server/storefront/catalog";

import { ActiveFilters, FacetFilters } from "./facet-filters";
import { Pagination } from "./pagination";
import { ProductGrid } from "./product-card";
import { SortForm } from "./sort-form";

export type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined, max = 200): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** Listado paginado reutilizado por catálogo, categoría, marca y búsqueda. */
export async function ProductListing({
  store,
  basePath,
  searchParams,
  categoryPath,
  brandSlug,
  query,
  emptyTitle,
  emptyText,
}: {
  store: StorePublic;
  basePath: string;
  searchParams: SearchParams;
  categoryPath?: string;
  brandSlug?: string;
  query?: string;
  emptyTitle: string;
  emptyText: string;
}) {
  const sortParam = one(searchParams.orden);
  const sort = LIST_SORTS.find((s) => s === sortParam) as ListSort | undefined;
  const available = one(searchParams.disponible) === "1";
  const cursor = one(searchParams.desde);
  // Filtros de atributos de la URL (R-T04); la base ignora los que la tienda no tiene.
  // Solo lo que la tienda tiene filtra (y salta la caché): un parámetro cualquiera
  // con forma de filtro no abre lecturas sin caché (Gate R).
  const parsed = parseAttributeParams(searchParams);
  const known = hasSelection(parsed)
    ? await listFacets(store.id, { categoryPath, brandSlug, query, available })
    : [];
  const requested = Object.fromEntries(
    Object.entries(parsed)
      .map(([key, values]) => {
        const facet = known.find((f) => f.key === key);
        return [key, values.filter((v) => facet?.values.some((x) => x.key === v))] as const;
      })
      .filter(([, values]) => values.length > 0),
  );
  const [page, facets] = await Promise.all([
    listProducts(store.id, {
      categoryPath,
      brandSlug,
      query,
      sort,
      available,
      attributes: requested,
      cursor,
    }),
    listFacets(store.id, { categoryPath, brandSlug, query, available, attributes: requested }),
  ]);

  // Solo lo que la tienda reconoció queda en los enlaces.
  const selected = facets.flatMap((f) =>
    f.values.filter((v) => v.selected).map((v) => ({ facet: f, value: v })),
  );
  const selectionParams = selectionPairs(
    Object.fromEntries(
      facets
        .map((f) => [f.key, f.values.filter((v) => v.selected).map((v) => v.key)] as const)
        .filter(([, values]) => values.length > 0),
    ),
  );
  const baseParams: [string, string][] = [
    ...(query ? [["q", query] as [string, string]] : []),
    ...(sort ? [["orden", sort] as [string, string]] : []),
    ...(available ? [["disponible", "1"] as [string, string]] : []),
  ];
  const href = (pairs: [string, string][]) => {
    const qs = new URLSearchParams(pairs).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const next = encodeListCursor(page.next_cursor);
  const filtered = selected.length > 0;

  return (
    <div className="space-y-6">
      <SortForm
        action={basePath}
        sort={page.sort}
        available={available}
        hidden={selectionParams}
        {...(query ? { query } : {})}
      />
      <div className={facets.length > 0 ? "grid gap-6 md:grid-cols-[15rem_1fr]" : ""}>
        {facets.length > 0 ? (
          <div>
            <FacetFilters
              action={basePath}
              facets={facets}
              hidden={baseParams}
              clearHref={filtered ? href(baseParams) : null}
            />
          </div>
        ) : null}
        <div className="min-w-0 space-y-4">
          <ActiveFilters
            items={selected.map(({ facet, value }) => ({
              facet: facet.name,
              label: value.label,
              href: href([
                ...baseParams,
                ...selectionParams.filter(([k, v]) => !(k === facet.key && v === value.key)),
              ]),
            }))}
          />
          {page.items.length === 0 ? (
            <section className="rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-6">
              {filtered ? (
                <>
                  <h2 className="font-semibold">Ningún producto coincide con estos filtros</h2>
                  <p className="mt-1 text-sm text-[var(--sf-muted)]">
                    Prueba con menos filtros o{" "}
                    <Link href={href(baseParams)} className="underline">
                      quítalos todos
                    </Link>
                    .
                  </p>
                </>
              ) : (
                <>
                  <h2 className="font-semibold">{emptyTitle}</h2>
                  <p className="mt-1 text-sm text-[var(--sf-muted)]">{emptyText}</p>
                </>
              )}
            </section>
          ) : (
            <section aria-labelledby="sf-resultados">
              <h2 id="sf-resultados" className="sr-only">
                Productos
              </h2>
              <ProductGrid products={page.items} store={store} eager={cursor ? 0 : 4} />
            </section>
          )}
        </div>
      </div>
      <Pagination
        firstHref={cursor ? href([...baseParams, ...selectionParams]) : null}
        nextHref={next ? href([...baseParams, ...selectionParams, ["desde", next]]) : null}
      />
    </div>
  );
}
