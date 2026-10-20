import type { Metadata } from "next";
import Link from "next/link";

import { formatMoney } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { resumeQueue } from "@/server/jobs/run-now";
import { configIssues } from "@/server/system/health";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Inicio" };

const STATUS: Record<string, string> = {
  draft: "Borrador (no visible para compradores)",
  active: "Publicada",
  paused: "Pausada",
  suspended: "Suspendida",
  closed: "Cerrada",
};

const ROLE: Record<string, string> = {
  org_owner: "Dueño de la organización",
  org_admin: "Administrador de la organización",
  org_member: "Miembro",
};

const RANGES: Record<string, { days: number; label: string }> = {
  "7": { days: 7, label: "7 días" },
  "30": { days: 30, label: "30 días" },
  "90": { days: 90, label: "90 días" },
};

interface Kpis {
  from: string;
  to: string;
  gross_sales: number;
  refunds: number;
  net_sales: number;
  orders: number;
  average_ticket: number;
  series: { day: string; sales: number; orders: number }[];
  top_products: { product_id: string | null; title: string; quantity: number; revenue: number }[];
  pending_payment: number;
  needs_attention: number;
  to_fulfill: number;
  low_stock:
    | {
        variant_id: string;
        title: string;
        sku: string | null;
        available: number;
        threshold: number;
      }[]
    | null;
}

/** Fecha local "YYYY-MM-DD" − n días (las fechas del rango son de la zona de la tienda). */
function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export default async function StoreHomePage({ params, searchParams }: Props) {
  const ctx = await getStoreContextForPage((await params).storeHandle);
  const sp = await searchParams;
  const rangeKey =
    typeof sp.rango === "string" && Object.hasOwn(RANGES, sp.rango) ? sp.rango : "30";
  const base = `/admin/${ctx.store.handle}`;
  const m = (cents: number) => formatMoney(cents, ctx.store.currency);
  // Los atajos a Pedidos solo para quien puede verlos (si no, llevarían a un 404).
  const canOrders = hasPermission(ctx, "orders.read");

  let kpis: Kpis | null = null;
  if (hasPermission(ctx, "analytics.read")) {
    const supabase = await createSupabaseServerClient();
    // Sin fechas: la base calcula "hoy" en la zona horaria de la tienda.
    const today = await callRpc<Kpis>(supabase, "dashboard_kpis", {
      p_store_id: ctx.store.id,
      p_from: null,
      p_to: null,
    });
    kpis =
      rangeKey === "30"
        ? today
        : await callRpc<Kpis>(supabase, "dashboard_kpis", {
            p_store_id: ctx.store.id,
            p_from: minusDays(today.to, RANGES[rangeKey]!.days - 1),
            p_to: today.to,
          });
  }
  // Opiniones esperando revisión (ADR-029): ninguna se publica sola.
  let pendingReviews: number | null = null;
  if (kpis && hasPermission(ctx, "products.read")) {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("product_reviews")
      .select("id", { count: "exact", head: true })
      .eq("store_id", ctx.store.id)
      .eq("status", "pending");
    pendingReviews = count ?? 0;
  }
  const max = kpis ? Math.max(1, ...kpis.series.map((s) => s.sales)) : 1;

  // Estado del sistema (plan del panel, A2): configuración que falta y trabajo en cola.
  const canManage = hasPermission(ctx, "store.update");
  const issues = canManage ? configIssues() : [];
  let waiting: { photos: number; imports: number } | null = null;
  if (canManage) {
    const supabase = await createSupabaseServerClient();
    const [photos, imports] = await Promise.all([
      supabase
        .from("media")
        .select("id", { count: "exact", head: true })
        .eq("store_id", ctx.store.id)
        .eq("status", "pending")
        .is("deleted_at", null),
      supabase
        .from("import_jobs")
        .select("id", { count: "exact", head: true })
        .eq("store_id", ctx.store.id)
        .eq("status", "committing"),
    ]);
    waiting = { photos: photos.count ?? 0, imports: imports.count ?? 0 };
    // Fotos sin clave de Storage: retomar solo gastaría sus intentos (D-PANEL-10).
    const photosCanRun = !issues.some((i) => i.key === "image_processing");
    if (waiting.imports > 0 || (photosCanRun && waiting.photos > 0)) resumeQueue("home");
  }

  // Tienda sin publicar: cuántos pendientes le faltan (misión panel, F3).
  let launchPending: number | null = null;
  if (ctx.store.status === "draft" && canManage) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc("stores_launch_checklist", { p_store_id: ctx.store.id });
    launchPending = ((data as { issues?: unknown[] } | null)?.issues ?? []).length;
  }
  const quickActions = [
    {
      href: `${base}/productos/nuevo`,
      label: "Agregar producto",
      show: hasPermission(ctx, "products.create"),
    },
    {
      href: `${base}/pedidos?estado=por-surtir`,
      label: "Pedidos por surtir",
      show: canOrders,
    },
    {
      href: `${base}/productos/importar`,
      label: "Importar productos",
      show: hasPermission(ctx, "imports.run"),
    },
    {
      href: `${base}/apariencia`,
      label: "Cambiar diseño",
      show: hasPermission(ctx, "appearance.manage"),
    },
  ].filter((a) => a.show);

  // Estado del sistema: arriba si hay algo que atender, al final si todo funciona.
  const healthy = !waiting || (issues.length === 0 && waiting.photos + waiting.imports === 0);
  const systemState =
    canManage && waiting ? (
      <section aria-labelledby="sistema" className="space-y-2">
        <h2 id="sistema" className="font-semibold">
          Estado del sistema
        </h2>
        {issues.length === 0 && waiting.photos + waiting.imports === 0 ? (
          <p className="text-sm text-success">Todo funciona: no hay trabajos en espera.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {issues.map((issue) => (
              <li key={issue.key} className="rounded-md border border-warning p-3">
                <p className="font-medium">{issue.title}</p>
                <p className="text-fg-muted">{issue.impact}</p>
                <p className="mt-1">Cómo resolverlo: {issue.fix}</p>
              </li>
            ))}
            {waiting.photos > 0 ? (
              <li className="rounded-md border border-border p-3">
                {waiting.photos === 1
                  ? "1 foto en proceso."
                  : `${waiting.photos} fotos en proceso.`}
                {issues.some((i) => i.key === "image_processing")
                  ? " Esperan a que se configure la optimización de imágenes."
                  : " Se terminan en unos segundos."}
              </li>
            ) : null}
            {waiting.imports > 0 ? (
              <li className="rounded-md border border-border p-3">
                <Link href={`${base}/productos/importar`} className="underline">
                  {waiting.imports === 1
                    ? "1 importación en curso"
                    : `${waiting.imports} importaciones en curso`}
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </section>
    ) : null;

  return (
    <section className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-xl font-semibold">{ctx.store.name}</h1>
        <p className="text-[13px] text-fg-muted">
          {STATUS[ctx.store.status] ?? ctx.store.status} · Tu acceso:{" "}
          {ctx.supportGrantId
            ? "Soporte (solo lectura)"
            : (ROLE[ctx.orgRole ?? ""] ?? "Equipo de la tienda")}
        </p>
        {launchPending !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent p-4">
            <p className="text-sm">
              <strong>Tu tienda aún no está publicada.</strong>{" "}
              {launchPending === 0
                ? "Ya tiene todo lo necesario."
                : launchPending === 1
                  ? "Le falta 1 paso."
                  : `Le faltan ${launchPending} pasos.`}
            </p>
            <Link
              href={`${base}/configuracion`}
              className="inline-flex h-11 items-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              {launchPending === 0 ? "Publicar mi tienda" : "Terminar de configurar"}
            </Link>
          </div>
        ) : null}
        {quickActions.length > 0 ? (
          <nav aria-label="Acciones rápidas" className="flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="inline-flex h-11 items-center rounded-[var(--radius-control)] border border-control px-4 text-sm font-medium hover:bg-canvas"
              >
                {a.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {systemState && !healthy ? systemState : null}

      {kpis ? (
        <>
          <section aria-labelledby="pendientes" className="space-y-2">
            <h2 id="pendientes" className="font-semibold">
              Por atender
            </h2>
            <ul className="flex flex-wrap gap-3 text-sm">
              <li className="rounded-md border border-border px-3 py-2">
                {canOrders ? (
                  <Link href={`${base}/pedidos?estado=por-surtir`} className="underline">
                    {kpis.to_fulfill} por surtir
                  </Link>
                ) : (
                  `${kpis.to_fulfill} por surtir`
                )}
              </li>
              <li className="rounded-md border border-border px-3 py-2">
                {canOrders ? (
                  <Link href={`${base}/pedidos?estado=pendientes`} className="underline">
                    {kpis.pending_payment} pendientes de pago
                  </Link>
                ) : (
                  `${kpis.pending_payment} pendientes de pago`
                )}
              </li>
              <li
                className={`rounded-md border px-3 py-2 ${kpis.needs_attention > 0 ? "border-warning" : "border-border"}`}
              >
                {kpis.needs_attention > 0 ? "⚠ " : ""}
                {canOrders && kpis.needs_attention > 0 ? (
                  <Link href={`${base}/pedidos?estado=atencion`} className="underline">
                    {kpis.needs_attention} necesitan atención
                  </Link>
                ) : (
                  `${kpis.needs_attention} necesitan atención`
                )}
              </li>
              {pendingReviews ? (
                <li className="rounded-md border border-border px-3 py-2">
                  <Link href={`${base}/productos/opiniones`} className="underline">
                    {pendingReviews === 1
                      ? "1 opinión por revisar"
                      : `${pendingReviews} opiniones por revisar`}
                  </Link>
                </li>
              ) : null}
            </ul>
          </section>

          <section aria-labelledby="ventas" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="ventas" className="font-semibold">
                Ventas · {dayLabel(kpis.from)} – {dayLabel(kpis.to)}
              </h2>
              <nav aria-label="Periodo" className="flex gap-1 text-sm">
                {Object.entries(RANGES).map(([key, r]) => (
                  <Link
                    key={key}
                    href={`${base}?rango=${key}`}
                    aria-current={key === rangeKey ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-md border px-3 py-1 md:min-h-0 ${key === rangeKey ? "border-fg font-medium" : "border-border"}`}
                  >
                    {r.label}
                  </Link>
                ))}
              </nav>
            </div>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-md border border-border p-4">
                <dt className="text-[13px] text-fg-muted">Ventas netas</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{m(kpis.net_sales)}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-[13px] text-fg-muted">Pedidos pagados</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{kpis.orders}</dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-[13px] text-fg-muted">Ticket promedio</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {m(kpis.average_ticket)}
                </dd>
              </div>
              <div className="rounded-md border border-border p-4">
                <dt className="text-[13px] text-fg-muted">Reembolsos</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{m(kpis.refunds)}</dd>
              </div>
            </dl>

            <figure className="space-y-2">
              <figcaption className="text-[13px] text-fg-muted">
                Ventas por día (antes de reembolsos)
              </figcaption>
              {/* Una sola serie: sin leyenda. SVG (no estilos en línea: la CSP los bloquea);
                  tooltip nativo por barra y la misma información en la tabla. */}
              <svg
                viewBox={`0 0 ${kpis.series.length * 10} 100`}
                preserveAspectRatio="none"
                className="h-36 w-full border-b border-border"
                role="img"
                aria-label={`Ventas por día del ${dayLabel(kpis.from)} al ${dayLabel(kpis.to)}. Detalle en la tabla.`}
              >
                {kpis.series.map((s, i) => {
                  const h = s.sales > 0 ? Math.max(1.5, (s.sales / max) * 100) : 0;
                  const x = i * 10 + 1;
                  return (
                    <g key={s.day} className="group">
                      <title>{`${dayLabel(s.day)}: ${m(s.sales)} · ${s.orders} pedidos`}</title>
                      {/* Área de cursor más grande que la barra. */}
                      <rect x={i * 10} y={0} width={10} height={100} fill="transparent" />
                      {h > 0 ? (
                        <path
                          d={`M${x},100 V${100 - h + 2} Q${x},${100 - h} ${x + 2},${100 - h} H${x + 6} Q${x + 8},${100 - h} ${x + 8},${100 - h + 2} V100 Z`}
                          className="fill-accent group-hover:fill-accent-hover"
                        />
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              <details className="text-sm">
                <summary className="cursor-pointer min-h-11 py-3 md:min-h-0 md:py-0 text-[13px] text-fg-muted">
                  Ver como tabla
                </summary>
                <table className="mt-2 w-full max-w-md text-left">
                  <thead className="text-[13px] text-fg-muted">
                    <tr>
                      <th className="py-1 font-medium">Día</th>
                      <th className="py-1 font-medium">Ventas</th>
                      <th className="py-1 font-medium">Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.series
                      .filter((s) => s.orders > 0)
                      .map((s) => (
                        <tr key={s.day}>
                          <td className="py-1">{dayLabel(s.day)}</td>
                          <td className="py-1">{m(s.sales)}</td>
                          <td className="py-1">{s.orders}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </details>
            </figure>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section aria-labelledby="top" className="space-y-2">
              <h2 id="top" className="font-semibold">
                Más vendidos
              </h2>
              {kpis.top_products.length === 0 ? (
                <p className="text-sm text-fg-muted">Sin ventas en el periodo.</p>
              ) : (
                <ol className="divide-y divide-border text-sm">
                  {kpis.top_products.map((p, i) => (
                    <li
                      key={`${p.product_id ?? p.title}-${i}`}
                      className="flex justify-between gap-3 py-2"
                    >
                      <span>
                        {i + 1}. {p.title}
                      </span>
                      <span className="text-fg-muted">
                        {p.quantity} u · {m(p.revenue)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {kpis.low_stock ? (
              <section aria-labelledby="stock" className="space-y-2">
                <h2 id="stock" className="font-semibold">
                  Existencias bajas
                </h2>
                {kpis.low_stock.length === 0 ? (
                  <p className="text-sm text-fg-muted">
                    Nada por debajo de su mínimo. Define mínimos en Inventario.
                  </p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {kpis.low_stock.map((l) => (
                      <li key={l.variant_id} className="flex justify-between gap-3 py-2">
                        <Link href={`${base}/inventario/${l.variant_id}`} className="underline">
                          {l.title}
                          {l.sku ? ` · ${l.sku}` : ""}
                        </Link>
                        <span>
                          {l.available} disponibles (mínimo {l.threshold})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        </>
      ) : null}
      {systemState && healthy ? systemState : null}
    </section>
  );
}
