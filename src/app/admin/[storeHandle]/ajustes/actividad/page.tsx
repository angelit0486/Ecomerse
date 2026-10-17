import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { AUDIT_ACTIONS as ACTIONS } from "./labels";

export const metadata: Metadata = { title: "Actividad" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

interface AuditItem {
  occurred_at: string;
  actor_type: string;
  actor_label: string;
  via_support: boolean;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
}

const AREAS: Record<string, string> = {
  "": "Todo",
  pedidos: "Pedidos y pagos",
  clientes: "Clientes",
  catalogo: "Catálogo e inventario",
  tienda: "Tienda y apariencia",
  equipo: "Equipo y soporte",
  datos: "Importaciones y exportaciones",
};

/** Etiquetas legibles; una acción nueva sin etiqueta muestra su clave. */
/** Motivos que pone el sistema (los del equipo se muestran tal cual). */
const REASONS: Record<string, string> = {
  compliance: "dejó de cumplir las reglas sanitarias",
};

/** Ajustes → Actividad (F8-T05): auditoría de la tienda, sin IP ni PII completa. */
export default async function ActivityPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "audit.read")) notFound();
  // Hora de la tienda (no la del servidor).
  const when = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });
  const sp = await searchParams;
  const area = typeof sp.area === "string" && Object.hasOwn(AREAS, sp.area) ? sp.area : "";
  const cursor = typeof sp.antes === "string" ? sp.antes.slice(0, 80) : null;
  const supabase = await createSupabaseServerClient();
  const page = await callRpc<{ items: AuditItem[]; next_cursor: string | null }>(
    supabase,
    "audit_list",
    { p_store_id: ctx.store.id, p_area: area || null, p_cursor: cursor, p_limit: 50 },
  ).catch(() => ({ items: [] as AuditItem[], next_cursor: null }));
  const base = `/admin/${ctx.store.handle}/ajustes/actividad`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Actividad</h1>
        <p className="text-sm text-fg-muted">
          Quién cambió qué en tu tienda. El registro no se puede editar ni borrar.
        </p>
      </header>
      <nav aria-label="Área" className="flex flex-wrap gap-1 text-sm">
        {Object.entries(AREAS).map(([key, label]) => (
          <Link
            key={key || "todo"}
            href={key ? `${base}?area=${key}` : base}
            aria-current={key === area ? "page" : undefined}
            className={`rounded-md border px-3 py-1 ${key === area ? "border-fg font-medium" : "border-border"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <EmptyState title="Sin actividad" description="Aquí aparecerán los cambios del equipo." />
      ) : (
        <ol className="divide-y divide-border text-sm">
          {page.items.map((e, i) => (
            <li key={`${e.occurred_at}-${i}`} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]">
              <time dateTime={e.occurred_at} className="text-fg-muted">
                {when.format(new Date(e.occurred_at))}
              </time>
              <div>
                <span className="font-medium">
                  {e.via_support ? "Soporte de la plataforma" : e.actor_label}
                </span>
                {" · "}
                {ACTIONS[e.action] ?? e.action}
                {e.reason ? (
                  <span className="block text-fg-muted">
                    Motivo: {REASONS[e.reason] ?? e.reason}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {page.next_cursor ? (
        <Link
          href={`${base}?${new URLSearchParams({ ...(area ? { area } : {}), antes: page.next_cursor })}`}
          className="text-sm underline"
        >
          Anteriores
        </Link>
      ) : null}
    </section>
  );
}
