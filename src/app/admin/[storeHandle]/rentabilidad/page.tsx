import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import {
  marginLabel,
  minusDays,
  PROFIT_RANGES,
  profitNotes,
  profitReportSchema,
  revenueWithCost,
} from "@/lib/profit/report";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../_shared/panel-flags";

export const metadata: Metadata = { title: "Rentabilidad" };

const dayLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/**
 * Reporte de rentabilidad (interruptor profit_report): cuánto dejó lo vendido
 * después del costo. Todo el cálculo vive en `public.profit_report()`.
 */
export default async function ProfitPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ rango?: string }>;
}) {
  const [{ storeHandle }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "analytics.read") || !hasPermission(ctx, "products.cost.read")) {
    notFound();
  }
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "profit_report"))) notFound();

  const rangeKey = sp.rango && PROFIT_RANGES[sp.rango] ? sp.rango : "30";
  const load = async (from: string | null, to: string | null) =>
    profitReportSchema.parse(
      await callRpc(supabase, "profit_report", {
        p_store_id: ctx.store.id,
        p_from: from,
        p_to: to,
      }),
    );
  // Sin fechas: la base calcula «hoy» en la zona horaria de la tienda (30 días).
  const today = await load(null, null);
  const report =
    rangeKey === "30"
      ? today
      : await load(minusDays(today.to, PROFIT_RANGES[rangeKey]!.days - 1), today.to);

  const m = (cents: number) => formatMoney(cents, ctx.store.currency);
  const base = `/admin/${ctx.store.handle}`;
  const withCost = revenueWithCost(report);
  const canOrders = hasPermission(ctx, "orders.read");

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Rentabilidad</h1>
          <p className="text-sm text-fg-muted">
            Pedidos pagados del {dayLabel(report.from)} al {dayLabel(report.to)}.
          </p>
        </div>
        <nav aria-label="Periodo" className="flex gap-1 text-sm">
          {Object.entries(PROFIT_RANGES).map(([key, r]) => (
            <Link
              key={key}
              href={`${base}/rentabilidad?rango=${key}`}
              aria-current={key === rangeKey ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1 md:min-h-0 ${key === rangeKey ? "border-fg font-medium" : "border-border"}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      {report.orders === 0 ? (
        <p role="status" className="rounded-md border border-border p-4 text-sm">
          No hay pedidos pagados en este periodo.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-fg p-4">
              <dt className="text-[13px] text-fg-muted">Utilidad</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{m(report.profit)}</dd>
            </div>
            <div className="rounded-md border border-border p-4">
              <dt className="text-[13px] text-fg-muted">Margen</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {marginLabel(report.profit, withCost)}
              </dd>
            </div>
            <div className="rounded-md border border-border p-4">
              <dt className="text-[13px] text-fg-muted">Venta de productos</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{m(report.revenue)}</dd>
            </div>
            <div className="rounded-md border border-border p-4">
              <dt className="text-[13px] text-fg-muted">Costo de lo vendido</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{m(report.cost)}</dd>
            </div>
          </dl>

          <section aria-labelledby="como" className="space-y-2 text-sm">
            <h2 id="como" className="font-semibold">
              Cómo sale la cuenta
            </h2>
            <dl className="max-w-md space-y-1 tabular-nums">
              <div className="flex justify-between gap-4">
                <dt>Venta de productos con costo (sin impuestos ni envío)</dt>
                <dd>{m(withCost)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Menos costo de lo vendido</dt>
                <dd>−{m(report.cost)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Menos otros reembolsos</dt>
                <dd>−{m(report.other_refunds)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
                <dt>Utilidad</dt>
                <dd>{m(report.profit)}</dd>
              </div>
            </dl>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              {profitNotes(report).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="por-producto" className="space-y-2">
            <h2 id="por-producto" className="font-semibold">
              Por producto
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[13px] text-fg-muted">
                    <th scope="col" className="py-2 pr-4 font-normal">
                      Producto
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Unidades
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Venta
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Costo
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Utilidad
                    </th>
                    <th scope="col" className="py-2 text-right font-normal">
                      Margen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p) => (
                    <tr key={p.product_id ?? p.title} className="border-b border-border">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        {p.title}
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.units}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{m(p.revenue)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {p.cost === null ? "Sin costo" : m(p.cost)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {p.profit === null ? "—" : m(p.profit)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {marginLabel(p.profit, p.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="por-pedido" className="space-y-2">
            <h2 id="por-pedido" className="font-semibold">
              Por pedido (los 50 más recientes)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[13px] text-fg-muted">
                    <th scope="col" className="py-2 pr-4 font-normal">
                      Pedido
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      Pagado
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Venta
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">
                      Costo
                    </th>
                    <th scope="col" className="py-2 text-right font-normal">
                      Utilidad
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.order_rows.map((o) => (
                    <tr key={o.order_id} className="border-b border-border">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        {canOrders ? (
                          <Link href={`${base}/pedidos/${o.order_id}`} className="underline">
                            {o.number}
                          </Link>
                        ) : (
                          o.number
                        )}
                      </th>
                      <td className="py-2 pr-4">{dayLabel(o.paid_at)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{m(o.revenue)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{m(o.cost)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {o.profit === null ? "Falta costo" : m(o.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
