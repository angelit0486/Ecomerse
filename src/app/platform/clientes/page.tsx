import Link from "next/link";
import { notFound } from "next/navigation";

import {
  clientStatuses,
  LIGHT_LABEL,
  storeOverview,
  type ClientStatus,
  type Light,
} from "@/lib/platform/client-health";
import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";
import { Input } from "@/ui/primitives/input";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

export const metadata = { title: "Mis clientes" };

const LIGHT_CLASS: Record<Light, string> = {
  red: "border-danger text-danger",
  amber: "border-warning text-warning",
  green: "border-success text-success",
};
const LIGHT_DOT: Record<Light, string> = { red: "●", amber: "▲", green: "✓" };

/** El semáforo siempre con texto y forma: nunca solo el color. */
function LightBadge({ light }: { light: Light }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-medium ${LIGHT_CLASS[light]}`}
    >
      <span aria-hidden="true">{LIGHT_DOT[light]}</span>
      {LIGHT_LABEL[light]}
    </span>
  );
}

/**
 * Con muchas tiendas la página sigue siendo ligera: la base devuelve hasta
 * FETCH_LIMIT, las más urgentes primero (busca en todas); aquí se muestran las
 * 30 que más ayuda necesitan y una tabla de 100.
 */
const FETCH_LIMIT = 300;
const HELP_LIMIT = 30;
const TABLE_LIMIT = 100;

const num = (n: number) => n.toLocaleString("es-MX");

const DAY = 86_400_000;
function ago(iso: string | null, now: Date): string {
  if (!iso) return "Nunca";
  const d = Math.floor((now.getTime() - Date.parse(iso)) / DAY);
  return d <= 0 ? "Hoy" : d === 1 ? "Ayer" : `Hace ${d} días`;
}

/**
 * Consola → «Mis clientes»: el estado de cada tienda en una fila y, arriba, las
 * que necesitan ayuda hoy con el motivo. Para dar soporte antes de que el
 * comercio se queje. Solo dueña y administración (trae ventas de todas las tiendas).
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const role = await requirePlatformRole();
  if (!canManageTenants(role)) notFound();
  const supabase = await createSupabaseServerClient();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const rows = storeOverview.parse(
    await callRpc(supabase, "platform_store_overview", {
      p_search: q || null,
      p_limit: FETCH_LIMIT,
    }),
  );
  const total = rows[0]?.total_count ?? 0;
  // eslint-disable-next-line react-hooks/purity -- página de servidor: «ahora» de esta solicitud
  const now = new Date(Date.now());
  const all = clientStatuses(rows, now);
  const help = all.filter((c) => c.light !== "green");
  const count = (l: Light) => all.filter((c) => c.light === l).length;

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Mis clientes</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          El estado de cada tienda con datos reales de hoy. Atiende primero a las de arriba: así
          ayudas antes de que el comercio tenga que escribirte.
        </p>
      </header>

      {all.length > 0 || q ? (
        <form role="search" className="max-w-sm">
          <label htmlFor="q" className="text-[13px] font-medium">
            Buscar tienda u organización
          </label>
          <Input id="q" name="q" defaultValue={q} />
        </form>
      ) : null}

      {all.length === 0 && !q ? (
        <EmptyState
          title="Todavía no hay tiendas"
          description="Cuando crees la primera organización con su tienda, aquí verás su estado."
          action={
            <Link href="/platform/organizaciones/nueva" className="underline">
              Crear organización y tienda
            </Link>
          }
        />
      ) : (
        <>
          {total > all.length ? (
            <p className="text-sm text-fg-muted">
              Resumen de las {all.length} tiendas más urgentes de {num(total)}. Busca por nombre
              para ver una en particular.
            </p>
          ) : null}
          <dl className="grid gap-3 sm:grid-cols-3" aria-label="Resumen del semáforo">
            {(["red", "amber", "green"] as const).map((l) => (
              <div
                key={l}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 sm:block sm:p-4"
              >
                <dt>
                  <LightBadge light={l} />
                </dt>
                <dd className="text-2xl font-semibold tabular-nums sm:mt-2">{count(l)}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="ayuda" className="space-y-3">
            <h2 id="ayuda" className="text-base font-semibold">
              Necesitan ayuda hoy
            </h2>
            {help.length === 0 && !q ? (
              <p className="text-sm text-success">
                Todas las tiendas están al día: no hay nada pendiente.
              </p>
            ) : (
              <>
                <ul className="space-y-3">
                  {help.slice(0, HELP_LIMIT).map((c) => (
                    <HelpItem key={c.row.store_id} client={c} />
                  ))}
                </ul>
                {help.length > HELP_LIMIT ? (
                  <p className="text-sm text-fg-muted">
                    Y {help.length - HELP_LIMIT} tiendas más. Usa la búsqueda para encontrar una.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <Table caption="Todas las tiendas">
            <THead>
              <TR>
                <TH>Tienda</TH>
                <TH>Estado</TH>
                <TH>Visitantes en 7 días</TH>
                <TH>Ventas en 30 días</TH>
                <TH>Última venta</TH>
                <TH>Último acceso del equipo</TH>
                <TH>Plan</TH>
              </TR>
            </THead>
            <TBody>
              {all.slice(0, TABLE_LIMIT).map(({ row, light }) => (
                <TR key={row.store_id}>
                  <TD>
                    <Link
                      href={`/platform/organizaciones/${row.organization_id}`}
                      className="block font-medium underline"
                    >
                      {row.store_name}
                    </Link>
                    <span className="text-[13px] text-fg-muted">
                      {row.organization_name}
                      {row.store_status === "draft" ? " · en preparación" : ""}
                    </span>
                  </TD>
                  <TD>
                    <LightBadge light={light} />
                  </TD>
                  <TD className="tabular-nums">
                    {row.visitors_7d === null ? "—" : num(row.visitors_7d)}
                  </TD>
                  <TD className="tabular-nums">{row.paid_orders_30d}</TD>
                  <TD>{ago(row.last_paid_at, now)}</TD>
                  <TD>{ago(row.last_staff_sign_in_at, now)}</TD>
                  <TD>{row.plan_key ?? "Sin plan"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {total > Math.min(all.length, TABLE_LIMIT) ? (
            <p className="text-sm text-fg-muted">
              Mostrando {Math.min(all.length, TABLE_LIMIT)} de {num(total)} tiendas, las más
              urgentes primero. Busca por nombre para ver las demás.
            </p>
          ) : null}
          {q && all.length === 0 ? (
            <p className="text-sm text-fg-muted">Ninguna tienda coincide con «{q}».</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function HelpItem({ client: { row, signals, light } }: { client: ClientStatus }) {
  return (
    <li className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{row.store_name}</p>
          <p className="text-[13px] text-fg-muted">
            {row.organization_name}
            {row.owner_email ? ` · ${row.owner_email}` : ""}
          </p>
        </div>
        <LightBadge light={light} />
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        {signals.map((s) => (
          <li key={s.code} className={s.level === "red" ? "font-medium" : undefined}>
            {s.text}
          </li>
        ))}
      </ul>
      <Link
        href={`/platform/organizaciones/${row.organization_id}`}
        className="mt-3 inline-flex min-h-11 items-center text-sm underline sm:min-h-9"
      >
        Ver la organización de {row.store_name}
      </Link>
    </li>
  );
}
