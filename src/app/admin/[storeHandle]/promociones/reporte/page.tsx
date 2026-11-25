import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { minusDays } from "@/lib/profit/report";
import {
  discountShare,
  promotionsReportSchema,
  reachLabel,
  REPORT_RANGES,
  type PromotionsReport,
} from "@/lib/promotions/report";
import { hasPermission } from "@/server/auth/context";
import { canSeePlan } from "@/server/billing/plan-usage";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { STATUS_LABEL } from "../shared";

export const metadata: Metadata = { title: "Reporte de promociones" };

const dayLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Reporte de promociones (ADR-070, fase 4; función de plan `promotion_reports`,
 * Tienda Plus). Solo lectura: `public.promotions_report()` hace todo el cálculo
 * con la copia guardada en cada pedido pagado. Sin la función, una invitación a
 * subir de plan.
 */
export default async function PromotionsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ rango?: string }>;
}) {
  const [{ storeHandle }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "discounts.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const rangeKey = sp.rango && REPORT_RANGES[sp.rango] ? sp.rango : "30";
  const load = async (from: string | null, to: string | null) =>
    promotionsReportSchema.parse(
      await callRpc(supabase, "promotions_report", {
        p_store_id: ctx.store.id,
        p_from: from,
        p_to: to,
      }),
    );

  let report: PromotionsReport | null;
  try {
    // Sin fechas: la base calcula «hoy» en la zona horaria de la tienda (30 días).
    const today = await load(null, null);
    report =
      rangeKey === "30"
        ? today
        : await load(minusDays(today.to, REPORT_RANGES[rangeKey]!.days - 1), today.to);
  } catch (error) {
    // not_found = el plan no incluye el reporte (la tienda y el permiso ya se revisaron).
    if (error instanceof AppError && error.code === "not_found") report = null;
    else throw error;
  }

  const base = `/admin/${ctx.store.handle}`;
  const m = (cents: number) => formatMoney(cents, ctx.store.currency);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm">
          <Link href={`${base}/promociones`} className="text-fg-muted underline">
            ← Promociones
          </Link>
        </p>
        <h1 className="text-xl font-semibold">Reporte de promociones</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Cuánto vendiste con cada promoción y cuánto le ahorraste a tus clientes. Cuenta los
          pedidos pagados del periodo (no los cancelados) y no resta devoluciones.
        </p>
      </header>

      {!report ? (
        <div
          role="note"
          className="max-w-2xl space-y-2 rounded-md border border-border p-4 text-sm"
        >
          <p className="font-medium">El reporte de promociones viene con el plan Tienda Plus.</p>
          <p className="text-fg-muted">
            Tus promociones funcionan igual en tu plan. Con Tienda Plus además ves, por promoción,
            cuántos pedidos la usaron, cuántas piezas se vendieron, cuánto descontaste y cuánto
            vendiste, para saber cuál conviene repetir.
          </p>
          {canSeePlan(ctx) ? (
            <p>
              <Link href={`${base}/ajustes/plan`} className="font-medium underline">
                Ver planes en Ajustes → Plan y uso
              </Link>
            </p>
          ) : (
            <p className="text-fg-muted">Pide a la dueña de la tienda que revise el plan.</p>
          )}
        </div>
      ) : (
        <>
          <nav aria-label="Periodo" className="flex flex-wrap gap-2 text-sm">
            {Object.entries(REPORT_RANGES).map(([key, r]) => (
              <Link
                key={key}
                href={`?rango=${key}`}
                aria-current={key === rangeKey ? "page" : undefined}
                className={`rounded-md border px-3 py-1.5 ${key === rangeKey ? "border-accent font-semibold" : "border-border"}`}
              >
                {r.label}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-fg-muted">
            Pedidos pagados del {dayLabel(report.from)} al {dayLabel(report.to)}.
          </p>
          <dl className="grid max-w-3xl gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <dt className="text-[13px] text-fg-muted">Pedidos con promoción</dt>
              <dd className="text-lg font-semibold tabular-nums">{report.totals.orders}</dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="text-[13px] text-fg-muted">Ahorro que diste</dt>
              <dd className="text-lg font-semibold tabular-nums">{m(report.totals.discount)}</dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="text-[13px] text-fg-muted">Venta con promoción</dt>
              <dd className="text-lg font-semibold tabular-nums">{m(report.totals.sales)}</dd>
            </div>
          </dl>
          {reachLabel(report.totals) ? (
            <p className="text-sm">{reachLabel(report.totals)}</p>
          ) : null}

          {report.rows.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Ningún pedido pagado de este periodo usó una promoción.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Resultados por promoción</caption>
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Promoción
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Pedidos
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Piezas
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Ahorro que diste
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Venta
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr key={r.promotion_id ?? `copia-${i}`} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <span className="font-medium">{r.name ?? "Promoción"}</span>
                        <span className="block text-[13px] text-fg-muted">
                          {r.label}
                          {r.status ? ` · ${STATUS_LABEL[r.status] ?? r.status}` : ""}
                        </span>
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.units}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m(r.discount)}
                        {discountShare(r) ? (
                          <span className="block text-[13px] text-fg-muted">
                            {discountShare(r)} del precio
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right tabular-nums">{m(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="max-w-2xl text-[13px] text-fg-muted">
            «Piezas» y «Venta» cuentan las partidas que recibieron la promoción, con lo que el
            cliente pagó por ellas (ya con descuentos e impuestos incluidos si tus precios los
            incluyen). Los nombres son los de hoy; los números, los que guardó cada pedido.
          </p>
        </>
      )}
    </section>
  );
}
