import Link from "next/link";

import {
  GOAL_KEY,
  hasSelection,
  parseAttributeParams,
  parseBrandParams,
  selectionPairs,
} from "@/lib/catalog/attributes";
import {
  parsePriceFilter,
  priceFilterCents,
  priceFilterLabel,
  priceFilterPairs,
} from "@/lib/catalog/price-filter";
import type { StorePublic } from "@/server/storefront/store-public";
import {
  encodeListCursor,
  getDiscoverySummary,
  LIST_SORTS,
  listFacets,
  listProducts,
  type ListSort,
} from "@/server/storefront/catalog";

import { ActiveFilters, FacetFilters } from "./facet-filters";
import { Pagination } from "./pagination";
import { ProductGrid } from "./product-card";
import { money } from "./format";
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
  title,
  emptyTitle,
  emptyText,
  onlyOffers = false,
}: {
  store: StorePublic;
  /** h1 del listado; con un solo objetivo elegido pasa a «Para tu …» (revisión M6). */
  title?: string;
  basePath: string;
  searchParams: SearchParams;
  categoryPath?: string;
  brandSlug?: string;
  query?: string;
  emptyTitle: string;
  emptyText: string;
  /** Página «Ofertas»: siempre filtra por descuento real. */
  onlyOffers?: boolean;
}) {
  const sortParam = one(searchParams.orden);
  const sort = LIST_SORTS.find((s) => s === sortParam) as ListSort | undefined;
  const available = one(searchParams.disponible) === "1";
  const cursor = one(searchParams.desde);
  // Precio y ofertas (super prompt §7): en la URL, compartibles; la base filtra.
  const parsedPrice = parsePriceFilter(searchParams);
  const price = { ...parsedPrice, onSale: onlyOffers || parsedPrice.onSale };
  const cents = priceFilterCents(price);
  // Filtros de atributos de la URL (R-T04); la base ignora los que la tienda no tiene.
  // Solo lo que la tienda tiene filtra (y salta la caché): un parámetro cualquiera
  // con forma de filtro no abre lecturas sin caché (Gate R).
  const parsed = parseAttributeParams(searchParams);
  // Marca como filtro (F9-T04); en la página de una marca no aplica.
  const parsedBrands = brandSlug ? [] : parseBrandParams(searchParams);
  const known =
    hasSelection(parsed) || parsedBrands.length > 0
      ? await listFacets(store.id, {
          categoryPath,
          brandSlug,
          query,
          available,
          ...cents,
          onSale: price.onSale,
        })
      : [];
  const brandFacet = known.find((f) => f.key === "marca");
  const brands = parsedBrands.filter((b) => brandFacet?.values.some((v) => v.key === b));
  const requested = Object.fromEntries(
    Object.entries(parsed)
      .map(([key, values]) => {
        const facet = known.find((f) => f.key === key);
        return [key, values.filter((v) => facet?.values.some((x) => x.key === v))] as const;
      })
      .filter(([, values]) => values.length > 0),
  );
  const [page, facets, summary] = await Promise.all([
    listProducts(store.id, {
      categoryPath,
      brandSlug,
      query,
      sort,
      available,
      attributes: requested,
      brands,
      cursor,
      ...cents,
      onSale: price.onSale,
    }),
    listFacets(store.id, {
      categoryPath,
      brandSlug,
      query,
      available,
      attributes: requested,
      brands,
      ...cents,
      onSale: price.onSale,
    }),
    getDiscoverySummary(store.id),
  ]);

  // Solo lo que la tienda reconoció queda en los enlaces.
  const selected = facets.flatMap((f) =>
    f.values.filter((v) => v.selected).map((v) => ({ facet: f, value: v })),
  );
  // En «Ofertas» la oferta es la página, no un filtro que se pueda quitar.
  const pricePairs = priceFilterPairs({ ...price, onSale: price.onSale && !onlyOffers });
  const attributePairs = selectionPairs(
    Object.fromEntries(
      facets
        .map((f) => [f.key, f.values.filter((v) => v.selected).map((v) => v.key)] as const)
        .filter(([, values]) => values.length > 0),
    ),
  );
  const selectionParams = [...attributePairs, ...pricePairs];
  const baseParams: [string, string][] = [
    ...(query ? [["q", query] as [string, string]] : []),
    ...(sort ? [["orden", sort] as [string, string]] : []),
    ...(available ? [["disponible", "1"] as [string, string]] : []),
  ];
  const href = (pairs: [string, string][]) => {
    const qs = new URLSearchParams(pairs).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const fmt = (pesos: number) => money(pesos * 100, store).replace(/[.,]00$/, "");
  const priceLabel = priceFilterLabel(price, fmt);
  const without = (names: string[]) => selectionParams.filter(([k]) => !names.includes(k));
  const extraChips = [
    ...(priceLabel
      ? [
          {
            facet: "Precio",
            label: priceLabel,
            href: href([...baseParams, ...without(["precio_min", "precio_max"])]),
          },
        ]
      : []),
    ...(price.onSale && !onlyOffers
      ? [
          {
            facet: "Ofertas",
            label: "Solo ofertas",
            href: href([...baseParams, ...without(["oferta"])]),
          },
        ]
      : []),
  ];
  const filtered = selected.length > 0 || extraChips.length > 0;
  const filterForm = (
    <FacetFilters
      action={basePath}
      facets={facets}
      hidden={baseParams}
      clearHref={filtered ? href(baseParams) : null}
      price={price}
      showOnSale={!onlyOffers && summary.offers > 0}
    />
  );
  const next = encodeListCursor(page.next_cursor);
  // Agotados al final de la página en cualquier orden (revisión de conversión, M6);
  // el orden relativo del resto no cambia.
  const items = [...page.items].sort(
    (a, b) => Number(a.availability === "out_of_stock") - Number(b.availability === "out_of_stock"),
  );
  const goal =
    selected.length === 1 && selected[0]!.facet.key === GOAL_KEY ? selected[0]!.value.label : null;
  const heading = title && goal ? `Para tu ${goal.toLocaleLowerCase("es-MX")}` : title;
  const nothing = page.items.length === 0 && !filtered;

  return (
    <div className="space-y-6">
      {heading ? (
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl">
          {heading}
        </h1>
      ) : null}
      {nothing && query ? (
        <NoResults store={store} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            {nothing ? null : (
              <SortForm
                action={basePath}
                sort={page.sort}
                available={available}
                hidden={selectionParams}
                {...(query ? { query } : {})}
              />
            )}
            {typeof page.total === "number" && page.total > 0 ? (
              <p className="text-sm text-[var(--sf-muted)]">
                {page.total} {page.total === 1 ? "producto" : "productos"}
              </p>
            ) : null}
          </div>
          <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
            {nothing ? null : (
              <div>
                {/* Móvil: plegados tras «Filtros (n)» (sin JS ni saltos de diseño); escritorio:
                siempre visibles. Solo uno de los dos está en pantalla. */}
                <details className="md:hidden">
                  <summary className="mb-3 inline-flex min-h-11 cursor-pointer items-center rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium">
                    {selected.length + extraChips.length > 0
                      ? `Filtros (${selected.length + extraChips.length})`
                      : "Filtros"}
                  </summary>
                  {filterForm}
                </details>
                <div className="hidden md:block">{filterForm}</div>
              </div>
            )}
            <div className="min-w-0 space-y-4">
              <ActiveFilters
                items={[
                  ...selected.map(({ facet, value }) => ({
                    facet: facet.name,
                    label: value.label,
                    href: href([
                      ...baseParams,
                      ...selectionParams.filter(([k, v]) => !(k === facet.key && v === value.key)),
                    ]),
                  })),
                  ...extraChips,
                ]}
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
                  <h2 id="sf-resultados" className="sr-only font-semibold">
                    Productos
                  </h2>
                  <ProductGrid products={items} store={store} eager={cursor ? 0 : 4} />
                </section>
              )}
            </div>
          </div>
          <Pagination
            firstHref={cursor ? href([...baseParams, ...selectionParams]) : null}
            nextHref={next ? href([...baseParams, ...selectionParams, ["desde", next]]) : null}
          />
        </>
      )}
    </div>
  );
}

/**
 * Búsqueda sin resultados (revisión de conversión, M7): en lugar de un callejón
 * sin salida, los objetivos de la tienda y lo más vendido disponible.
 */
async function NoResults({ store }: { store: StorePublic }) {
  const [facets, best] = await Promise.all([
    listFacets(store.id, {}),
    listProducts(store.id, { sort: "best_selling", available: true, limit: 4 }),
  ]);
  const goals = facets.find((f) => f.key === GOAL_KEY)?.values.filter((v) => v.count > 0) ?? [];
  return (
    <div className="space-y-8">
      <section className="space-y-2 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-6">
        <h2 className="font-semibold">Sin resultados</h2>
        <p className="text-sm text-[var(--sf-muted)]">
          Revisa la ortografía, prueba con menos palabras o explora por objetivo.
        </p>
        {goals.length > 0 ? (
          <ul aria-label="Comprar por objetivo" className="flex flex-wrap gap-2 pt-2">
            {goals.map((g) => (
              <li key={g.key}>
                <Link
                  href={`/productos?${new URLSearchParams([[GOAL_KEY, g.key]])}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium hover:bg-[var(--sf-surface)]"
                >
                  {g.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="pt-2 text-sm">
          <Link href="/productos" className="font-medium underline underline-offset-4">
            Ver todos los productos
          </Link>
        </p>
      </section>
      {best.items.length > 0 ? (
        <section aria-labelledby="sf-mas-vendido" className="space-y-4">
          <h2 id="sf-mas-vendido" className="text-2xl font-semibold tracking-tight">
            Lo más vendido
          </h2>
          <ProductGrid products={best.items} store={store} />
        </section>
      ) : null}
    </div>
  );
}
