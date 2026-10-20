import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { visibleStatus } from "@/lib/orders/visible-status";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { OrdersTable } from "./orders-table";

export const metadata: Metadata = { title: "Pedidos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTERS: Record<string, string> = {
  todos: "Todos",
  "por-surtir": "Por surtir",
  atencion: "Requieren atención",
  pendientes: "Pendientes de pago",
  pagados: "Pagados",
  cancelados: "Cancelados",
};
const PAGE = 50;

/** Listado de pedidos (lectura, F6): sin datos de contacto (D-F6-01). */
export default async function OrdersPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read")) notFound();
  const sp = await searchParams;
  const filter = typeof sp.estado === "string" && FILTERS[sp.estado] ? sp.estado : "todos";
  // Por surtir se atiende del más antiguo al más nuevo (plan del panel, C2).
  const oldestFirst = filter === "por-surtir";
  // Cursor (placed_at, id): pedidos con la misma hora no se saltan (Gate F6).
  const cursor =
    typeof sp.antes === "string" ? /^(.{10,40})\|([0-9a-f-]{36})$/.exec(sp.antes) : null;
  const before =
    cursor && !Number.isNaN(Date.parse(cursor[1]!)) ? { at: cursor[1]!, id: cursor[2]! } : null;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select(
      "id, display_number, placed_at, total, currency, status, payment_status, fulfillment_status, needs_attention",
    )
    .eq("store_id", ctx.store.id)
    .order("placed_at", { ascending: oldestFirst })
    .order("id", { ascending: oldestFirst })
    .limit(PAGE + 1);
  // Misma definición que el contador «por surtir» de Inicio (dashboard_kpis).
  if (filter === "por-surtir") {
    query = query
      .eq("status", "open")
      .in("fulfillment_status", ["unfulfilled", "partially_fulfilled"]);
  }
  if (filter === "atencion") query = query.eq("needs_attention", true);
  if (filter === "pendientes") query = query.eq("status", "pending_payment");
  if (filter === "pagados") query = query.eq("status", "open");
  if (filter === "cancelados") query = query.eq("status", "cancelled");
  if (before) {
    const op = oldestFirst ? "gt" : "lt";
    query = query.or(
      `placed_at.${op}.${before.at},and(placed_at.eq.${before.at},id.${op}.${before.id})`,
    );
  }
  const [{ data, error }, dispatches] = await Promise.all([
    query,
    // Enlace a la bandeja de despachos solo si la tienda ya tiene alguno (ADR-025).
    supabase
      .from("supplier_orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", ctx.store.id)
      .in("status", ["pending", "requested", "confirmed", "shipped", "failed"]),
  ]);
  if (error) throw error;
  if (dispatches.error) throw dispatches.error;
  const rows = (data ?? []).slice(0, PAGE) as {
    id: string;
    display_number: string;
    placed_at: string;
    total: number;
    currency: string;
    status: string;
    payment_status: string;
    fulfillment_status: string;
    needs_attention: boolean;
  }[];
  const last = rows.at(-1);
  const next = (data ?? []).length > PAGE && last ? `${last.placed_at}|${last.id}` : null;
  const base = `/admin/${ctx.store.handle}/pedidos`;
  // Fechas en el calendario de la tienda (el servidor corre en UTC).
  const when = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Pedidos</h1>
          {(dispatches.count ?? 0) > 0 ? (
            <Link
              href={`${base}/despachos`}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Despachos de proveedores por atender ({dispatches.count})
            </Link>
          ) : null}
        </div>
        <nav aria-label="Filtrar pedidos" className="flex flex-wrap gap-3 text-sm">
          {Object.entries(FILTERS).map(([key, label]) => (
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
      {rows.length === 0 ? (
        filter === "por-surtir" ? (
          <EmptyState
            title="Nada por surtir"
            description="Todos los pedidos pagados ya salieron. Los nuevos aparecerán aquí."
          />
        ) : (
          <EmptyState title="Sin pedidos" description="Los pedidos de tu tienda aparecerán aquí." />
        )
      ) : (
        <OrdersTable
          storeHandle={ctx.store.handle}
          // Surtir en bloque solo en «Por surtir» y con permiso de surtir.
          selectable={filter === "por-surtir" && hasPermission(ctx, "orders.fulfill")}
          rows={rows.map((o) => ({
            id: o.id,
            number: o.display_number,
            href: `${base}/${o.id}`,
            placedAt: when.format(new Date(o.placed_at)),
            status: visibleStatus(o),
            total: formatMoney(o.total, o.currency),
          }))}
        />
      )}
      {next ? (
        <Link
          href={`${base}?estado=${filter}&antes=${encodeURIComponent(next)}`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          {oldestFirst ? "Más pedidos" : "Pedidos anteriores"}
        </Link>
      ) : null}
    </section>
  );
}
