import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import {
  decodeCursor,
  listCategories,
  publicMediaUrl,
  searchProducts,
} from "@/server/catalog/queries";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { STATUS_LABELS } from "./messages";
import { BulkProductsTable } from "./product-list";
import { linkButton, nativeControl } from "./styles";

export const metadata: Metadata = { title: "Productos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUSES = ["draft", "active", "archived"] as const;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length <= 200 ? value : undefined;
}

interface ListExtras {
  image: string | null;
  brand: string | null;
  available: number | null;
  sold_out_variants: number | null;
}

/** «12 disponibles» · «Agotado» · «Sin control de existencias»; null sin permiso de inventario. */
function stockLabel(extras: ListExtras | undefined): string | null {
  if (!extras || extras.sold_out_variants == null) return null;
  if (extras.available == null) return "Sin control de existencias";
  if (extras.available <= 0) return "Agotado";
  return extras.available === 1 ? "1 disponible" : `${extras.available} disponibles`;
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read")) notFound();
  const sp = await searchParams;

  const query = one(sp.q)?.trim() || undefined;
  const statusParam = one(sp.estado);
  const status = STATUSES.find((s) => s === statusParam);
  const categoryParam = one(sp.categoria);
  const deleted = one(sp.eliminados) === "1";
  const cursor = decodeCursor(one(sp.desde));

  const supabase = await createSupabaseServerClient();
  const [categories, page] = await Promise.all([
    listCategories(supabase, ctx.store.id),
    searchProducts(supabase, ctx.store.id, {
      query,
      status,
      categoryId:
        categoryParam && /^[0-9a-f-]{36}$/.test(categoryParam) ? categoryParam : undefined,
      deleted,
      cursor,
    }),
  ]);

  const base = `/admin/${ctx.store.handle}/productos`;
  const filtersActive = Boolean(query || status || categoryParam || deleted);
  const nextHref = page.nextCursor
    ? `${base}?${new URLSearchParams({
        ...(query ? { q: query } : {}),
        ...(status ? { estado: status } : {}),
        ...(categoryParam ? { categoria: categoryParam } : {}),
        ...(deleted ? { eliminados: "1" } : {}),
        desde: page.nextCursor,
      })}`
    : null;

  const canCreate = hasPermission(ctx, "products.create");
  const bulk = {
    status: hasPermission(ctx, "products.publish"),
    delete: hasPermission(ctx, "products.delete"),
  };
  // Miniatura, marca y existencias de la página (una consulta; existencias solo con inventory.read).
  const extras =
    page.rows.length > 0
      ? await callRpc<Record<string, ListExtras>>(supabase, "catalog_list_extras", {
          p_store_id: ctx.store.id,
          p_product_ids: page.rows.map((r) => r.id),
        })
      : {};

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Productos</h1>
          <p className="text-sm text-fg-muted">Lo que vendes en {ctx.store.name}.</p>
        </div>
        <nav aria-label="Catálogo" className="flex flex-wrap gap-2">
          {hasPermission(ctx, "categories.manage") ? (
            <Link href={`${base}/categorias`} className={`${linkButton} border border-control`}>
              Categorías
            </Link>
          ) : null}
          {hasPermission(ctx, "brands.manage") ? (
            <Link href={`${base}/marcas`} className={`${linkButton} border border-control`}>
              Marcas
            </Link>
          ) : null}
          {hasPermission(ctx, "categories.manage") ? (
            <Link href={`${base}/atributos`} className={`${linkButton} border border-control`}>
              Atributos
            </Link>
          ) : null}
          <Link href={`${base}/revision`} className={`${linkButton} border border-control`}>
            Revisión
          </Link>
          <Link href={`${base}/opiniones`} className={`${linkButton} border border-control`}>
            Opiniones
          </Link>
          {hasPermission(ctx, "products.cost.read") ? (
            <Link href={`${base}/proveedores`} className={`${linkButton} border border-control`}>
              Proveedores
            </Link>
          ) : null}
          {hasPermission(ctx, "imports.run") ? (
            <Link href={`${base}/importar`} className={`${linkButton} border border-control`}>
              Importar
            </Link>
          ) : null}
          {canCreate ? (
            <Link
              href={`${base}/nuevo`}
              className={`${linkButton} bg-accent text-accent-fg hover:bg-accent-hover`}
            >
              Agregar producto
            </Link>
          ) : null}
        </nav>
      </header>

      {sp.eliminado === "1" ? (
        <p role="status" className="text-sm text-success">
          Producto eliminado. Puedes restaurarlo desde «Ver eliminados».
        </p>
      ) : null}

      <form
        method="get"
        action={base}
        role="search"
        aria-label="Buscar productos"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="q" className="text-[13px] font-medium">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query ?? ""}
            placeholder="Título o SKU"
            className={`${nativeControl} w-64 px-3`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="estado" className="text-[13px] font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={status ?? ""} className={nativeControl}>
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {categories.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="categoria" className="text-[13px] font-medium">
              Categoría
            </label>
            <select
              id="categoria"
              name="categoria"
              defaultValue={categoryParam ?? ""}
              className={nativeControl}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {"— ".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="eliminados" value="1" defaultChecked={deleted} />
          Ver eliminados
        </label>
        <button type="submit" className={`${linkButton} border border-control`}>
          Filtrar
        </button>
        {filtersActive ? (
          <Link href={base} className="text-sm underline">
            Quitar filtros
          </Link>
        ) : null}
      </form>

      {page.rows.length === 0 ? (
        filtersActive || cursor ? (
          <EmptyState
            title="Sin resultados"
            description="Ningún producto coincide con estos filtros. Prueba con otra búsqueda."
          />
        ) : (
          <EmptyState
            title="Aún no tienes productos"
            description="Agrega tu primer producto con sus fotos, precio y variantes. Se guarda como borrador hasta que lo publiques."
            action={
              canCreate ? (
                <Link href={`${base}/nuevo`} className={`${linkButton} bg-accent text-accent-fg`}>
                  Agregar producto
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <BulkProductsTable
          storeHandle={ctx.store.handle}
          deletedView={deleted}
          canBulkStatus={bulk.status}
          canBulkDelete={bulk.delete}
          rows={page.rows.map((row) => ({
            id: row.id,
            title: row.title,
            href: `${base}/${row.id}`,
            status: STATUS_LABELS[row.status] ?? row.status,
            price:
              row.min_price == null
                ? "—"
                : row.min_price === row.max_price
                  ? formatMoney(row.min_price, ctx.store.currency)
                  : `${formatMoney(row.min_price, ctx.store.currency)} – ${formatMoney(row.max_price ?? row.min_price, ctx.store.currency)}`,
            variants: row.variant_count,
            image: extras[row.id]?.image ? publicMediaUrl(extras[row.id]!.image!) : null,
            brand: extras[row.id]?.brand ?? null,
            stock: stockLabel(extras[row.id]),
            soldOut: (extras[row.id]?.sold_out_variants ?? 0) > 0,
          }))}
        />
      )}

      <nav aria-label="Paginación" className="flex gap-3 text-sm">
        {cursor ? (
          <Link
            href={`${base}?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(status ? { estado: status } : {}), ...(categoryParam ? { categoria: categoryParam } : {}), ...(deleted ? { eliminados: "1" } : {}) })}`}
            className="underline"
          >
            Primera página
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className="underline">
            Siguiente página
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
