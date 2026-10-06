import type { StorePublic } from "@/server/storefront/store-public";
import {
  encodeListCursor,
  LIST_SORTS,
  listProducts,
  type ListSort,
} from "@/server/storefront/catalog";

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
  const page = await listProducts(store.id, {
    categoryPath,
    brandSlug,
    query,
    sort,
    available,
    cursor,
  });

  const params = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(sort ? { orden: sort } : {}),
      ...(available ? { disponible: "1" } : {}),
      ...extra,
    }).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const next = encodeListCursor(page.next_cursor);

  return (
    <div className="space-y-6">
      <SortForm
        action={basePath}
        sort={page.sort}
        available={available}
        {...(query ? { query } : {})}
      />
      {page.items.length === 0 ? (
        <section className="rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-6">
          <h2 className="font-semibold">{emptyTitle}</h2>
          <p className="mt-1 text-sm text-[var(--sf-muted)]">{emptyText}</p>
        </section>
      ) : (
        <ProductGrid products={page.items} store={store} eager={cursor ? 0 : 4} />
      )}
      <Pagination
        firstHref={cursor ? params({}) : null}
        nextHref={next ? params({ desde: next }) : null}
      />
    </div>
  );
}
