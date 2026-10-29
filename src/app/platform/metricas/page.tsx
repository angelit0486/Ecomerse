import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import {
  METRIC_WINDOWS,
  metricsSchema,
  parseWindow,
  subscriptionRows,
} from "@/lib/platform/metrics";
import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

export const metadata = { title: "Métricas" };
export const dynamic = "force-dynamic";

/**
 * Métricas del negocio de la plataforma (misión vendible F4): organizaciones,
 * suscripciones, tiendas y ventas de todas las tiendas. Solo dueña y
 * administración; la base vuelve a exigir el rol.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const role = await requirePlatformRole();
  if (!canManageTenants(role)) notFound();
  const days = parseWindow((await searchParams).dias);
  const supabase = await createSupabaseServerClient();
  const m = metricsSchema.parse(await callRpc(supabase, "platform_metrics", { p_days: days }));

  const cards: { label: string; value: string | number; hint?: string }[] = [
    {
      label: "Organizaciones activas",
      value: m.organizations.active,
      hint: `${m.organizations.new} nuevas en ${days} días`,
    },
    { label: "Tiendas publicadas", value: m.stores.live, hint: `${m.stores.draft} en borrador` },
    { label: "Tiendas con ventas", value: m.stores.with_sales, hint: `en ${days} días` },
    { label: "Pruebas que vencen en 7 días", value: m.trials_ending_7d },
  ];

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Métricas</h1>
          <p className="text-sm text-fg-muted">
            Datos reales de esta instalación. Ventas = lo cobrado menos lo reembolsado.
          </p>
        </div>
        <nav aria-label="Periodo" className="flex flex-wrap gap-2 text-sm">
          {METRIC_WINDOWS.map((w) => (
            <Link
              key={w}
              href={w === 30 ? "/platform/metricas" : `/platform/metricas?dias=${w}`}
              aria-current={w === days ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 md:min-h-9 ${
                w === days ? "border-accent bg-accent text-accent-fg" : "border-control"
              }`}
            >
              {w === 365 ? "1 año" : `${w} días`}
            </Link>
          ))}
        </nav>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-md border border-border bg-surface p-4">
            <dt className="text-[13px] text-fg-muted">{c.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{c.value}</dd>
            {c.hint ? <dd className="text-[13px] text-fg-muted">{c.hint}</dd> : null}
          </div>
        ))}
      </dl>

      <section aria-labelledby="ventas" className="space-y-2">
        <h2 id="ventas" className="text-base font-semibold">
          Ventas de las tiendas en {days === 365 ? "el último año" : `${days} días`}
        </h2>
        {m.sales.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Ninguna tienda ha cobrado pedidos en este periodo.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {m.sales.map((s) => (
              <li key={s.currency}>
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(s.net, s.currency)}
                </span>{" "}
                en {s.orders} {s.orders === 1 ? "pedido cobrado" : "pedidos cobrados"}
                {s.refunded > 0 ? ` (${formatMoney(s.refunded, s.currency)} reembolsados)` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="suscripciones"
          className="rounded-md border border-border bg-surface p-4"
        >
          <h2 id="suscripciones" className="mb-2 text-sm font-semibold">
            Suscripciones
          </h2>
          <dl className="space-y-1 text-sm">
            {subscriptionRows(m.subscriptions).map(([label, n]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="font-medium tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-border pt-3 text-sm">
            <p className="text-fg-muted">Ingreso mensual recurrente (MRR)</p>
            {m.mrr.length === 0 ? (
              <p>Sin precios cargados en los planes (Consola → Planes → Precios).</p>
            ) : (
              m.mrr.map((r) => (
                <p key={r.currency}>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMoney(r.amount, r.currency)}
                  </span>{" "}
                  de {r.subscriptions} {r.subscriptions === 1 ? "suscripción" : "suscripciones"}
                </p>
              ))
            )}
            {m.paying_without_price > 0 ? (
              <p className="text-[13px] text-fg-muted">
                {m.paying_without_price === 1
                  ? "1 suscripción que paga no tiene precio en su plan: no se cuenta."
                  : `${m.paying_without_price} suscripciones que pagan no tienen precio en su plan: no se cuentan.`}
              </p>
            ) : null}
            <p className="text-[13px] text-fg-muted">
              Activas y con pago vencido en gracia; las anuales cuentan su precio entre 12. Las de
              prueba no cuentan.
            </p>
          </div>
        </section>
        <section
          aria-labelledby="planes"
          className="rounded-md border border-border bg-surface p-4"
        >
          <h2 id="planes" className="mb-2 text-sm font-semibold">
            Organizaciones por plan
          </h2>
          {m.plans.length === 0 ? (
            <p className="text-sm text-fg-muted">Sin suscripciones vigentes.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {m.plans.map((p) => (
                <div key={p.key} className="flex justify-between gap-3">
                  <dt className="text-fg-muted">{p.name}</dt>
                  <dd className="font-medium tabular-nums">{p.organizations}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <section aria-labelledby="top" className="space-y-2">
        <h2 id="top" className="text-base font-semibold">
          Tiendas con más ventas
        </h2>
        {m.top_stores.length === 0 ? (
          <p className="text-sm text-fg-muted">Aún no hay ventas en este periodo.</p>
        ) : (
          <Table caption="Tiendas con más ventas" captionHidden>
            <THead>
              <TR>
                <TH>Tienda</TH>
                <TH>Pedidos cobrados</TH>
                <TH>Ventas</TH>
              </TR>
            </THead>
            <TBody>
              {m.top_stores.map((t) => (
                <TR key={`${t.handle}-${t.currency}`}>
                  <TD>
                    {t.store} <span className="text-fg-muted">({t.handle})</span>
                  </TD>
                  <TD className="tabular-nums">{t.orders}</TD>
                  <TD className="tabular-nums">{formatMoney(t.net, t.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <p className="text-sm text-fg-muted">
        Errores y cola de trabajos:{" "}
        <Link href="/platform/salud" className="underline">
          Salud
        </Link>
        .
      </p>
    </section>
  );
}
