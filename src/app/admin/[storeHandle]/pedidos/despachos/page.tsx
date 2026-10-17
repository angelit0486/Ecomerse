import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  isSupplierOrderStatus,
  SUPPLIER_ORDER_LABELS,
  SUPPLIER_ORDER_STATUSES,
} from "@/lib/orders/supplier-order-status";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listSupplierOrders, type SupplierOrderFilter } from "@/server/orders/supplier-orders";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { SupplierOrderCard } from "./supplier-order-card";

export const metadata: Metadata = { title: "Despachos de proveedores" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Bandeja de despachos por proveedor (ADR-025 paso 2): lo que falta pedir o seguir. */
export default async function SupplierOrdersPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read")) notFound();
  const sp = await searchParams;
  const raw = typeof sp.estado === "string" ? sp.estado : "open";
  const filter: SupplierOrderFilter =
    raw === "all" || raw === "open" || isSupplierOrderStatus(raw) ? raw : "open";
  const supabase = await createSupabaseServerClient();
  const { counts, items } = await listSupplierOrders(supabase, ctx.store.id, filter);
  const canUpdate = hasPermission(ctx, "orders.update");
  const base = `/admin/${ctx.store.handle}/pedidos/despachos`;
  const tabs: [SupplierOrderFilter, string][] = [
    ["open", "Por atender"],
    ...SUPPLIER_ORDER_STATUSES.filter((s) => (counts[s] ?? 0) > 0).map(
      (s) => [s, `${SUPPLIER_ORDER_LABELS[s]} (${counts[s]})`] as [SupplierOrderFilter, string],
    ),
    ["all", "Todos"],
  ];

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`/admin/${ctx.store.handle}/pedidos`} className="underline">
            Pedidos
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Despachos de proveedores</h1>
        <p className="text-sm text-fg-muted">
          Cuando se paga un pedido con piezas que salen de un proveedor, aquí aparece lo que hay que
          pedirle. Registra cada paso: la tienda no se comunica sola con el proveedor.
        </p>
        <nav aria-label="Filtrar despachos" className="flex flex-wrap gap-3 text-sm">
          {tabs.map(([key, label]) => (
            <Link
              key={key}
              href={`${base}?estado=${key}`}
              aria-current={key === filter ? "page" : undefined}
              className={key === filter ? "font-semibold underline" : "underline"}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      {items.length === 0 ? (
        <EmptyState
          title="Sin despachos"
          description={
            filter === "open"
              ? "No hay despachos pendientes con proveedores."
              : "No hay despachos con este estado."
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((so) => (
            <SupplierOrderCard
              key={so.id}
              storeHandle={ctx.store.handle}
              timeZone={ctx.store.timezone}
              supplierOrder={so}
              canUpdate={canUpdate}
              showOrder
            />
          ))}
        </div>
      )}
    </section>
  );
}
