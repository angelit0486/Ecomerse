import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { visibleStatus } from "@/lib/orders/visible-status";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

export const metadata: Metadata = { title: "Pedidos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTERS: Record<string, string> = {
  todos: "Todos",
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
  const before =
    typeof sp.antes === "string" && !Number.isNaN(Date.parse(sp.antes)) ? sp.antes : null;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select(
      "id, display_number, placed_at, total, currency, status, payment_status, fulfillment_status, needs_attention",
    )
    .eq("store_id", ctx.store.id)
    .order("placed_at", { ascending: false })
    .limit(PAGE + 1);
  if (filter === "pendientes") query = query.eq("status", "pending_payment");
  if (filter === "pagados") query = query.eq("status", "open");
  if (filter === "cancelados") query = query.eq("status", "cancelled");
  if (before) query = query.lt("placed_at", before);
  const { data, error } = await query;
  if (error) throw error;
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
  const next = (data ?? []).length > PAGE ? rows.at(-1)?.placed_at : null;
  const base = `/admin/${ctx.store.handle}/pedidos`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Pedidos</h1>
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
        <EmptyState title="Sin pedidos" description="Los pedidos de tu tienda aparecerán aquí." />
      ) : (
        <div role="region" aria-label="Pedidos" tabIndex={0} className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Pedidos de la tienda</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Pedido
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Fecha
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Estado
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <Link href={`${base}/${o.id}`} className="underline">
                      {o.display_number}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{new Date(o.placed_at).toLocaleString("es-MX")}</td>
                  <td className="py-2 pr-3">{visibleStatus(o)}</td>
                  <td className="py-2 text-right">{formatMoney(o.total, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next ? (
        <Link
          href={`${base}?estado=${filter}&antes=${encodeURIComponent(next)}`}
          className="text-sm underline"
        >
          Pedidos anteriores
        </Link>
      ) : null}
    </section>
  );
}
