import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

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
};

/** Etiquetas legibles; una acción nueva sin etiqueta muestra su clave. */
const ACTIONS: Record<string, string> = {
  "order.cancelled": "Canceló un pedido",
  "order.fulfilled": "Registró un envío",
  "order.refund_requested": "Solicitó un reembolso",
  "order.payment_confirmed_manually": "Confirmó un pago manual",
  "order.staff_note_updated": "Editó la nota de un pedido",
  "order.unshipped_closed": "Cerró unidades no enviadas",
  "order.attention_resolved": "Resolvió la atención de un pedido",
  "payments.account_saved": "Configuró el pago por transferencia",
  "payments.stripe_connected": "Conectó Stripe",
  "payments.stripe_status_changed": "Cambió el estado de Stripe",
  "customer.updated": "Editó un cliente",
  "customer.anonymized": "Eliminó los datos personales de un cliente",
  "customer.account_linked": "Un cliente creó su cuenta",
  "product.published": "Publicó un producto",
  "product.deleted": "Archivó un producto",
  "product.restored": "Restauró un producto",
  "product.duplicated": "Duplicó un producto",
  "inventory.adjusted": "Ajustó inventario",
  "inventory.threshold_set": "Cambió un mínimo de inventario",
  "category.saved": "Guardó una categoría",
  "brand.saved": "Guardó una marca",
  "store.updated": "Editó los datos de la tienda",
  "store.taxes_updated": "Cambió los impuestos",
  "store.notifications_updated": "Cambió las notificaciones",
  "store.launched": "Publicó la tienda",
  "theme.published": "Publicó la apariencia",
  "theme.draft_saved": "Guardó un borrador de apariencia",
  "shipping.zone_saved": "Guardó una zona de envío",
  "shipping.rate_saved": "Guardó una tarifa de envío",
  "discount.saved": "Guardó un descuento",
  "member.invited": "Invitó a alguien al equipo",
  "member.joined": "Se unió al equipo",
  "member.role_changed": "Cambió un rol",
  "member.removed": "Quitó a alguien del equipo",
  "support_session.started": "Soporte de la plataforma entró a la tienda",
  "support_session.ended": "Terminó una sesión de soporte",
  "support_session.page_viewed": "Soporte vio una página",
  "export.requested": "Descargó una exportación",
  "import.requested": "Subió un archivo de importación",
  "import.committed": "Confirmó una importación de productos",
};

const when = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

/** Ajustes → Actividad (F8-T05): auditoría de la tienda, sin IP ni PII completa. */
export default async function ActivityPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "audit.read")) notFound();
  const sp = await searchParams;
  const area = typeof sp.area === "string" && sp.area in AREAS ? sp.area : "";
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
                {e.reason ? <span className="block text-fg-muted">Motivo: {e.reason}</span> : null}
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
