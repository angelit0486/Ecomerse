import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { AdjustForm, ThresholdForm } from "./inventory-forms";
import { variantLabel } from "./labels";

export const metadata: Metadata = { title: "Inventario" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

interface InventoryRow {
  level_id: string;
  variant_id: string;
  product_id: string;
  product_title: string;
  option_signature: string;
  sku: string | null;
  track_inventory: boolean;
  inventory_policy: "deny" | "continue";
  on_hand: number;
  reserved: number;
  available: number;
  low_stock_threshold: number | null;
}

const PAGE_SIZE = 50;

export default async function InventoryPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "inventory.read")) notFound();
  const sp = await searchParams;
  const query = typeof sp.q === "string" ? sp.q.slice(0, 200).trim() : "";
  const lowStock = sp.bajo === "1";
  const page = Math.max(0, Math.min(1000, Number.parseInt(String(sp.pagina ?? "0"), 10) || 0));

  const supabase = await createSupabaseServerClient();
  const rows = await callRpc<InventoryRow[]>(supabase, "inventory_search", {
    p_store_id: ctx.store.id,
    p_query: query || null,
    p_low_stock: lowStock,
    p_offset: page * PAGE_SIZE,
    p_limit: PAGE_SIZE + 1,
  });
  const visible = rows.slice(0, PAGE_SIZE);
  // Lo que está a la venta con proveedores (ADR-025): solo cantidades.
  const supplierRows =
    visible.length > 0
      ? await callRpc<{ variant_id: string; available: number; reserved: number }[]>(
          supabase,
          "inventory_supplier_totals",
          { p_store_id: ctx.store.id, p_variant_ids: visible.map((r) => r.variant_id) },
        )
      : [];
  const supplierTotals = new Map(supplierRows.map((r) => [r.variant_id, r]));
  const canAdjust = hasPermission(ctx, "inventory.adjust");
  const base = `/admin/${ctx.store.handle}/inventario`;
  const link = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams({
      ...(query ? { q: query } : {}),
      ...(lowStock ? { bajo: "1" } : {}),
    });
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Inventario</h1>
        <p className="text-sm text-fg-muted">
          Existencias de tu bodega por variante. «Disponible» es lo que se puede vender: en mano
          menos reservado por pedidos. Lo de proveedores se indica aparte.
        </p>
      </header>

      <form
        method="get"
        action={base}
        role="search"
        aria-label="Buscar en el inventario"
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
            defaultValue={query}
            placeholder="Producto o SKU"
            className="h-9 w-64 rounded-[var(--radius-control)] border border-control bg-surface px-3 text-sm"
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="bajo" value="1" defaultChecked={lowStock} />
          Solo stock bajo
        </label>
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-control px-4 text-sm font-medium"
        >
          Filtrar
        </button>
      </form>

      {visible.length === 0 ? (
        query || lowStock ? (
          <EmptyState
            title="Sin resultados"
            description="Ninguna variante coincide con estos filtros."
          />
        ) : (
          <EmptyState
            title="Aún no hay inventario"
            description="Cada variante de tus productos aparece aquí con sus existencias. Agrega productos para empezar."
          />
        )
      ) : (
        <ul aria-label="Variantes" className="space-y-3">
          {visible.map((row) => {
            const label = [row.product_title, variantLabel(row.option_signature)]
              .filter(Boolean)
              .join(" · ");
            const low =
              row.track_inventory &&
              row.low_stock_threshold !== null &&
              row.available <= row.low_stock_threshold;
            return (
              <li key={row.level_id} className="space-y-3 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {label}
                    {row.sku ? (
                      <span className="ml-2 text-sm font-normal text-fg-muted">{row.sku}</span>
                    ) : null}
                  </h2>
                  <Link href={`${base}/${row.variant_id}`} className="text-sm underline">
                    Historial de {label}
                  </Link>
                </div>
                {row.track_inventory ? (
                  <dl
                    className="grid grid-cols-3 gap-2 text-sm sm:max-w-md"
                    aria-label={`Existencias de ${label}`}
                  >
                    <div>
                      <dt className="text-fg-muted">En mano</dt>
                      <dd className="font-medium">{row.on_hand}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Reservado</dt>
                      <dd className="font-medium">{row.reserved}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Disponible</dt>
                      <dd className="font-medium">
                        {row.available}
                        {low ? <span className="ml-2 text-danger">Stock bajo</span> : null}
                        {row.inventory_policy === "continue" ? (
                          <span className="ml-2 text-fg-muted">(se vende sin existencias)</span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-fg-muted">
                    Sin seguimiento de inventario: siempre disponible.
                  </p>
                )}
                {row.track_inventory &&
                ((supplierTotals.get(row.variant_id)?.available ?? 0) > 0 ||
                  (supplierTotals.get(row.variant_id)?.reserved ?? 0) > 0) ? (
                  <p className="text-sm text-fg-muted">
                    Con proveedores: {supplierTotals.get(row.variant_id)!.available} disponibles
                    {supplierTotals.get(row.variant_id)!.reserved > 0
                      ? `, ${supplierTotals.get(row.variant_id)!.reserved} reservadas`
                      : ""}
                    . La tienda los vende cuando se acaban los tuyos.
                  </p>
                ) : null}
                {canAdjust && row.track_inventory ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Ajustar existencias o aviso
                    </summary>
                    <div className="mt-3 space-y-4">
                      <AdjustForm
                        storeHandle={ctx.store.handle}
                        variantId={row.variant_id}
                        label={label}
                      />
                      <ThresholdForm
                        storeHandle={ctx.store.handle}
                        variantId={row.variant_id}
                        label={label}
                        threshold={row.low_stock_threshold}
                      />
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <nav aria-label="Paginación" className="flex gap-3 text-sm">
        {page > 0 ? (
          <Link
            href={link({ pagina: page - 1 === 0 ? null : String(page - 1) })}
            className="underline"
          >
            Página anterior
          </Link>
        ) : null}
        {rows.length > PAGE_SIZE ? (
          <Link href={link({ pagina: String(page + 1) })} className="underline">
            Página siguiente
          </Link>
        ) : null}
      </nav>
    </section>
  );
}
