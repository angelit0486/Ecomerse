import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";

import {
  CARD_ERROR,
  CARD_FORBIDDEN,
  CARD_OFF,
  cartRecoverySettingsHref,
  customersHref,
  formatAge,
  isStale,
  metricComparison,
  ordersHref,
  previousPeriod,
  type CardState,
} from "@/lib/dashboard/home-insights";
import { formatMoney } from "@/lib/money/format";
import { addDays } from "@/lib/time/zoned-day";
import {
  buildStoreAlerts,
  LEVEL_LABEL,
  storeAlertsSchema,
  type StoreAlert,
} from "@/lib/store-alerts/alerts";
import { hasPermission } from "@/server/auth/context";
import { resumeQueue } from "@/server/jobs/run-now";
import { configIssues } from "@/server/system/health";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { loadCard } from "@/server/dashboard/load-card";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { CardError, ComparisonLine } from "./_shared/home-cards";
import { panelFlagEnabled } from "./_shared/panel-flags";

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = { title: "Inicio" };

// D8 / M2 (Orden 10, mensaje 5): esta página retoma la cola al dibujarse
// (`resumeQueue` → `after()`, una pasada del runner de hasta 55 s). 60 s, igual
// que /api/jobs/run; no pasa del máximo de ningún plan de Vercel.
export const maxDuration = 60;

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

interface CustomerMix {
  from: string;
  to: string;
  new: number;
  returning: number;
}

interface RecoverableCarts {
  enabled: boolean;
  count: number;
  amount: number;
}

/** `placed_at` del pedido más antiguo de cada pendiente (null si no hay). */
interface OldestPending {
  to_fulfill: string | null;
  pending_payment: string | null;
  needs_attention: string | null;
}

/**
 * Punto 2: el pedido más antiguo de cada pendiente, con las MISMAS definiciones
 * que los contadores de `dashboard_kpis` y los filtros de la lista de pedidos.
 * Acotado por tienda; RLS exige `orders.read`.
 */
async function oldestPending(db: SupabaseClient, storeId: string): Promise<OldestPending> {
  const orders = () => db.from("orders").select("placed_at").eq("store_id", storeId);
  const results = await Promise.all([
    orders()
      .eq("status", "open")
      .in("fulfillment_status", ["unfulfilled", "partially_fulfilled"])
      .order("placed_at", { ascending: true })
      .limit(1),
    orders().eq("status", "pending_payment").order("placed_at", { ascending: true }).limit(1),
    orders().eq("needs_attention", true).order("placed_at", { ascending: true }).limit(1),
  ]);
  const [toFulfill, pendingPayment, needsAttention] = results.map(({ data, error }) => {
    if (error) throw error;
    return ((data ?? []) as { placed_at: string }[])[0]?.placed_at ?? null;
  });
  return {
    to_fulfill: toFulfill ?? null,
    pending_payment: pendingPayment ?? null,
    needs_attention: needsAttention ?? null,
  };
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

  const canAnalytics = hasPermission(ctx, "analytics.read");
  const canCustomers = hasPermission(ctx, "customers.read");
  const retryHref = `${base}?rango=${rangeKey}`;
  const storeId = ctx.store.id;
  const db = await createSupabaseServerClient();

  // Orden 1, punto 6: cada tarjeta carga por separado; un fallo deja esa tarjeta
  // en «No pudimos cargar…» (y queda en el log), nunca tumba Inicio ni se pinta en cero.
  const kpisState: CardState<Kpis> = canAnalytics
    ? await loadCard("kpis", storeId, async () => {
        // Sin fechas: la base calcula "hoy" en la zona horaria de la tienda.
        const today = await callRpc<Kpis>(db, "dashboard_kpis", {
          p_store_id: storeId,
          p_from: null,
          p_to: null,
        });
        return rangeKey === "30"
          ? today
          : callRpc<Kpis>(db, "dashboard_kpis", {
              p_store_id: storeId,
              p_from: addDays(today.to, -(RANGES[rangeKey]!.days - 1)),
              p_to: today.to,
            });
      })
    : CARD_FORBIDDEN;
  const kpis = kpisState.status === "ok" ? kpisState.data : null;
  const period = kpis ? { from: kpis.from, to: kpis.to } : null;

  const [previousState, customerMixState, cartsState, oldestState, reviewsState] =
    await Promise.all([
      // Punto 1: el mismo RPC con los N días inmediatamente anteriores.
      period
        ? loadCard("kpis_previous", storeId, () => {
            const prev = previousPeriod(period);
            return callRpc<Kpis>(db, "dashboard_kpis", {
              p_store_id: storeId,
              p_from: prev.from,
              p_to: prev.to,
            });
          })
        : Promise.resolve(kpisState.status === "error" ? CARD_ERROR : CARD_FORBIDDEN),
      // Punto 4: solo con permiso de clientes (la base vuelve a exigirlo).
      !canCustomers || !canAnalytics
        ? Promise.resolve(CARD_FORBIDDEN)
        : period
          ? loadCard("customer_mix", storeId, () =>
              callRpc<CustomerMix>(db, "dashboard_customer_mix", {
                p_store_id: storeId,
                p_from: period.from,
                p_to: period.to,
              }),
            )
          : Promise.resolve(CARD_ERROR),
      // Punto 3: definición del recordatorio de carritos (ADR-048).
      canAnalytics
        ? loadCard("recoverable_carts", storeId, () =>
            callRpc<RecoverableCarts>(db, "dashboard_recoverable_carts", { p_store_id: storeId }),
          )
        : Promise.resolve(CARD_FORBIDDEN),
      // Punto 2: el pedido más antiguo de cada pendiente (RLS: orders.read).
      canOrders && canAnalytics
        ? loadCard("oldest_pending", storeId, () => oldestPending(db, storeId))
        : Promise.resolve(CARD_FORBIDDEN),
      // Opiniones esperando revisión (ADR-029): ninguna se publica sola.
      canAnalytics && hasPermission(ctx, "products.read")
        ? loadCard("pending_reviews", storeId, async () => {
            const { count, error } = await db
              .from("product_reviews")
              .select("id", { count: "exact", head: true })
              .eq("store_id", storeId)
              .eq("status", "pending");
            if (error) throw error;
            return count ?? 0;
          })
        : Promise.resolve(CARD_OFF),
    ]);
  const previous = previousState.status === "ok" ? previousState.data : null;
  const pendingReviews = reviewsState.status === "ok" ? reviewsState.data : null;
  const oldest = oldestState.status === "ok" ? oldestState.data : null;
  const now = new Date();
  const max = kpis ? Math.max(1, ...kpis.series.map((s) => s.sales)) : 1;
  /** «El más antiguo: hace X» bajo cada pendiente (punto 2). */
  const pendingAge = (key: keyof OldestPending, count: number) => {
    if (count === 0 || oldestState.status === "forbidden" || oldestState.status === "off") {
      return null;
    }
    if (!oldest) {
      return (
        <span className="block text-[13px] text-fg-muted">No pudimos calcular su antigüedad.</span>
      );
    }
    const at = oldest[key];
    if (!at) return null;
    return (
      <span className={`block text-[13px] ${isStale(at, now) ? "text-warning" : "text-fg-muted"}`}>
        El más antiguo: {formatAge(at, now)}
      </span>
    );
  };

  // Estado del sistema (plan del panel, A2): configuración que falta y trabajo en cola.
  const canManage = hasPermission(ctx, "store.update");
  const issues = canManage ? configIssues() : [];
  // Orden correctiva 1: un conteo que falla ya no se pinta como «0 en espera»
  // («Todo funciona»): queda en `error` y la sección lo dice.
  const waitingState: CardState<{ photos: number; imports: number }> = canManage
    ? await loadCard("system_waiting", storeId, async () => {
        const [photos, imports] = await Promise.all([
          db
            .from("media")
            .select("id", { count: "exact", head: true })
            .eq("store_id", storeId)
            .eq("status", "pending")
            .is("deleted_at", null),
          db
            .from("import_jobs")
            .select("id", { count: "exact", head: true })
            .eq("store_id", storeId)
            .eq("status", "committing"),
        ]);
        if (photos.error) throw photos.error;
        if (imports.error) throw imports.error;
        return { photos: photos.count ?? 0, imports: imports.count ?? 0 };
      })
    : CARD_FORBIDDEN;
  const waiting = waitingState.status === "ok" ? waitingState.data : null;
  const waitingFailed = waitingState.status === "error";
  if (waiting) {
    // Fotos sin clave de Storage: retomar solo gastaría sus intentos (D-PANEL-10).
    const photosCanRun = !issues.some((i) => i.key === "image_processing");
    if (waiting.imports > 0 || (photosCanRun && waiting.photos > 0)) resumeQueue("home");
  }

  // Alertas accionables (Orden 10, O10-02): con «Salud de tu tienda» encendida.
  // Si la consulta falla, «Qué atender hoy» sigue en su lugar con el aviso del
  // fallo (Orden 1, punto 6) en vez de desaparecer.
  let alertsState: CardState<StoreAlert[]> = CARD_OFF;
  if (hasPermission(ctx, "products.read")) {
    const enabled = await loadCard("store_alerts_flag", storeId, () =>
      panelFlagEnabled(db, storeId, "store_health"),
    );
    if (enabled.status !== "ok") alertsState = enabled;
    else if (enabled.data) {
      alertsState = await loadCard("store_alerts", storeId, async () =>
        buildStoreAlerts(
          storeAlertsSchema.parse(
            await callRpc<unknown>(db, "store_alerts", { p_store_id: storeId }),
          ),
          base,
        ),
      );
    }
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
  const healthy =
    !waitingFailed && (!waiting || (issues.length === 0 && waiting.photos + waiting.imports === 0));
  const systemState =
    canManage && waitingFailed ? (
      <section aria-labelledby="sistema" className="space-y-2">
        <h2 id="sistema" className="font-semibold">
          Estado del sistema
        </h2>
        {issues.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {issues.map((issue) => (
              <li key={issue.key} className="rounded-md border border-warning p-3">
                <p className="font-medium">{issue.title}</p>
                <p className="text-fg-muted">{issue.impact}</p>
                <p className="mt-1">Cómo resolverlo: {issue.fix}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <CardError what="los trabajos en espera (fotos e importaciones)" retryHref={retryHref} />
      </section>
    ) : canManage && waiting ? (
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
                <Link href={`${base}/productos/importar/fotos`} className="underline">
                  {waiting.photos === 1
                    ? "1 foto en proceso"
                    : `${waiting.photos.toLocaleString("es-MX")} fotos en proceso`}
                </Link>
                {issues.some((i) => i.key === "image_processing")
                  ? ". Esperan a que se configure la optimización de imágenes."
                  : waiting.photos > 20
                    ? ". Abre el avance para que sigan sin esperar."
                    : ". Se terminan en unos segundos."}
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
        {alertsState.status === "ok" ? (
          <StoreAlertsPanel alerts={alertsState.data} />
        ) : alertsState.status === "error" ? (
          <section aria-labelledby="alertas" className="space-y-2">
            <h2 id="alertas" className="font-semibold">
              Qué atender hoy
            </h2>
            <CardError what="los pendientes de tus productos" retryHref={retryHref} />
          </section>
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
                  <Link href={ordersHref(base, "por-surtir")} className="underline">
                    {kpis.to_fulfill} por surtir
                  </Link>
                ) : (
                  `${kpis.to_fulfill} por surtir`
                )}
                {pendingAge("to_fulfill", kpis.to_fulfill)}
              </li>
              <li className="rounded-md border border-border px-3 py-2">
                {canOrders ? (
                  <Link href={ordersHref(base, "pendientes")} className="underline">
                    {kpis.pending_payment} pendientes de pago
                  </Link>
                ) : (
                  `${kpis.pending_payment} pendientes de pago`
                )}
                {pendingAge("pending_payment", kpis.pending_payment)}
              </li>
              <li
                className={`rounded-md border px-3 py-2 ${kpis.needs_attention > 0 ? "border-warning" : "border-border"}`}
              >
                {kpis.needs_attention > 0 ? "⚠ " : ""}
                {canOrders && kpis.needs_attention > 0 ? (
                  <Link href={ordersHref(base, "atencion")} className="underline">
                    {kpis.needs_attention} necesitan atención
                  </Link>
                ) : (
                  `${kpis.needs_attention} necesitan atención`
                )}
                {pendingAge("needs_attention", kpis.needs_attention)}
              </li>
              {reviewsState.status === "error" ? (
                <li className="rounded-md border border-border px-3 py-2 text-fg-muted">
                  No pudimos contar las opiniones por revisar.
                </li>
              ) : null}
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
              {(
                [
                  {
                    key: "net_sales",
                    label: "Ventas netas",
                    value: m(kpis.net_sales),
                    compare: (p: Kpis) =>
                      metricComparison(
                        kpis.net_sales,
                        p.net_sales,
                        m,
                        "Sin ventas en el periodo anterior",
                      ),
                  },
                  {
                    key: "orders",
                    label: "Pedidos pagados",
                    value: kpis.orders.toLocaleString("es-MX"),
                    compare: (p: Kpis) =>
                      metricComparison(
                        kpis.orders,
                        p.orders,
                        (n) => n.toLocaleString("es-MX"),
                        "Sin pedidos en el periodo anterior",
                      ),
                  },
                  {
                    key: "average_ticket",
                    label: "Ticket promedio",
                    value: m(kpis.average_ticket),
                    compare: (p: Kpis) =>
                      metricComparison(
                        kpis.average_ticket,
                        p.average_ticket,
                        m,
                        "Sin pedidos en el periodo anterior",
                      ),
                  },
                ] as const
              ).map((metric) => (
                <div key={metric.key} className="rounded-md border border-border p-4">
                  <dt className="text-[13px] text-fg-muted">{metric.label}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {/* Punto 5: la cifra lleva a los pedidos pagados en el mismo rango. */}
                    {canOrders && period ? (
                      <Link href={ordersHref(base, "todos", period)} className="hover:underline">
                        {metric.value}
                      </Link>
                    ) : (
                      metric.value
                    )}
                  </dd>
                  <dd>
                    {previous ? (
                      <ComparisonLine comparison={metric.compare(previous)} />
                    ) : (
                      <p className="mt-1 text-[13px] text-fg-muted">
                        No pudimos cargar el periodo anterior.{" "}
                        <Link href={retryHref} className="underline">
                          Reintenta
                        </Link>
                      </p>
                    )}
                  </dd>
                </div>
              ))}
              <div className="rounded-md border border-border p-4">
                <dt className="text-[13px] text-fg-muted">Reembolsos</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{m(kpis.refunds)}</dd>
              </div>
            </dl>

            <figure className="space-y-2">
              <figcaption className="text-[13px] text-fg-muted">
                Ventas por día (antes de reembolsos)
              </figcaption>
              {/* Sin ventas: un aviso del mismo alto en lugar de una gráfica en blanco. */}
              {kpis.series.every((s) => s.sales === 0) ? (
                <p className="flex h-36 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-fg-muted">
                  Aún no hay ventas en este periodo. Cuando cobres un pedido, aquí verás cuánto
                  vendes cada día.
                </p>
              ) : (
                /* Una sola serie: sin leyenda. SVG (no estilos en línea: la CSP los bloquea);
                  tooltip nativo por barra y la misma información en la tabla. */
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
              )}
              {kpis.orders > 0 ? (
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
              ) : null}
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
      ) : kpisState.status === "error" ? (
        <section aria-labelledby="ventas" className="space-y-2">
          <h2 id="ventas" className="font-semibold">
            Ventas y pedidos por atender
          </h2>
          <CardError what="tus ventas ni tus pedidos por atender" retryHref={retryHref} />
        </section>
      ) : null}

      {canAnalytics ? (
        <div className="grid gap-6 md:grid-cols-2">
          {customerMixState.status !== "forbidden" ? (
            <section aria-labelledby="clientes" className="space-y-2">
              <h2 id="clientes" className="font-semibold">
                Clientes del periodo
              </h2>
              {customerMixState.status === "ok" ? (
                customerMixState.data.new + customerMixState.data.returning === 0 ? (
                  <p className="text-sm text-fg-muted">
                    Aún no hay clientes con pedidos pagados en este periodo.
                  </p>
                ) : (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md border border-border p-3">
                      <dt className="text-[13px] text-fg-muted">Nuevos</dt>
                      <dd className="text-lg font-semibold tabular-nums">
                        {customerMixState.data.new.toLocaleString("es-MX")}
                      </dd>
                      <dd className="text-[13px] text-fg-muted">Su primera compra pagada</dd>
                    </div>
                    <div className="rounded-md border border-border p-3">
                      <dt className="text-[13px] text-fg-muted">Recurrentes</dt>
                      <dd className="text-lg font-semibold tabular-nums">
                        {customerMixState.data.returning.toLocaleString("es-MX")}
                      </dd>
                      <dd className="text-[13px] text-fg-muted">Ya te habían comprado antes</dd>
                    </div>
                  </dl>
                )
              ) : (
                <CardError what="tus clientes del periodo" retryHref={retryHref} />
              )}
              {customerMixState.status === "ok" ? (
                <Link
                  href={customersHref(base)}
                  className="inline-flex min-h-11 items-center text-sm underline md:min-h-0"
                >
                  Ver clientes
                </Link>
              ) : null}
            </section>
          ) : null}
          {cartsState.status !== "forbidden" ? (
            <section aria-labelledby="carritos" className="space-y-2">
              <h2 id="carritos" className="font-semibold">
                Carritos recuperables
              </h2>
              {cartsState.status === "ok" ? (
                <>
                  {cartsState.data.count === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Ningún carrito por recuperar ahora. Aquí verás los que dejaron con su correo
                      hace más de 3 horas.
                    </p>
                  ) : (
                    <p className="text-sm">
                      <strong className="tabular-nums">
                        {cartsState.data.count === 1
                          ? "1 carrito"
                          : `${cartsState.data.count.toLocaleString("es-MX")} carritos`}
                      </strong>{" "}
                      · {m(cartsState.data.amount)}{" "}
                      <span className="text-fg-muted">(estimado con los precios de hoy)</span>
                    </p>
                  )}
                  <p className="text-[13px] text-fg-muted">
                    {cartsState.data.enabled
                      ? "El recordatorio por correo está encendido: les escribimos una vez, 3 horas después."
                      : "El recordatorio por correo está apagado: nadie les escribe para que vuelvan."}{" "}
                    {hasPermission(ctx, "notifications.manage") ? (
                      <Link href={cartRecoverySettingsHref(base)} className="underline">
                        {cartsState.data.enabled ? "Ver el ajuste" : "Encenderlo"}
                      </Link>
                    ) : null}
                  </p>
                </>
              ) : (
                <CardError what="los carritos recuperables" retryHref={retryHref} />
              )}
            </section>
          ) : null}
        </div>
      ) : null}
      {systemState && healthy ? systemState : null}
    </section>
  );
}

const LEVEL_STYLE: Record<StoreAlert["level"], string> = {
  alta: "border-danger",
  media: "border-warning",
  baja: "border-border",
};

/** «Qué atender hoy»: cada alerta con su conteo, su urgencia y la lista para resolverla. */
function StoreAlertsPanel({ alerts }: { alerts: StoreAlert[] }) {
  return (
    <section aria-labelledby="alertas" className="space-y-2">
      <h2 id="alertas" className="font-semibold">
        Qué atender hoy
      </h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-success">
          Todo en orden: tus productos publicados tienen foto, categoría y existencias.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {alerts.map((alert) => (
            <li
              key={alert.key}
              className={`space-y-1 rounded-md border p-3 text-sm ${LEVEL_STYLE[alert.level]}`}
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {alert.title}:{" "}
                  <span className="tabular-nums">{alert.count.toLocaleString("es-MX")}</span>
                </span>
                <span className="text-[13px] text-fg-muted">{LEVEL_LABEL[alert.level]}</span>
              </p>
              <p className="text-fg-muted">{alert.description}</p>
              <p>{alert.action}</p>
              <Link
                href={alert.href}
                className="inline-flex min-h-11 items-center font-medium underline"
              >
                Ver {alert.count === 1 ? "el producto" : "los productos"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
