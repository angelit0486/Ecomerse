import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listSuppliers } from "@/server/catalog/suppliers";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { SupplierForm } from "./forms";
import { leadTimeLabel, SUPPLIER_STATUS_LABELS } from "./labels";

export const metadata: Metadata = { title: "Proveedores" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Proveedores (ADR-025): quién surte cada producto que no está en tu bodega.
 * Su disponibilidad se vende como inventario de su ubicación. La v1 es manual:
 * aquí capturas lo que te informa el proveedor; no hay sincronización
 * automática y la pantalla nunca dice que la hubo.
 */
export default async function SuppliersPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.cost.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const suppliers = await listSuppliers(supabase, ctx.store.id);
  const canEdit = hasPermission(ctx, "products.update");
  const base = `/admin/${ctx.store.handle}/productos/proveedores`;
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-6">
      <header>
        <Link
          href={`/admin/${ctx.store.handle}/productos`}
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Proveedores</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Para productos que te surte un proveedor (despacho directo). Lo que informe que tiene
          disponible se vende como inventario aparte de tu bodega, con reservas y sin sobreventa.
          Captura manual: actualízalo cada vez que el proveedor te informe.
        </p>
      </header>
      {canEdit ? <SupplierForm storeHandle={ctx.store.handle} /> : null}
      {suppliers.length === 0 ? (
        <EmptyState
          title="Aún no tienes proveedores"
          description="Agrega uno para vincular las variantes que te surte."
        />
      ) : (
        <ul
          aria-label="Proveedores"
          className="divide-y divide-border rounded-md border border-border"
        >
          {suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
              <div className="space-y-0.5">
                <Link href={`${base}/${s.id}`} className="font-medium underline underline-offset-4">
                  {s.name}
                </Link>
                <p className="text-sm text-fg-muted">
                  {SUPPLIER_STATUS_LABELS[s.status]} ·{" "}
                  {s.variants === 1 ? "1 variante" : `${s.variants} variantes`}
                  {leadTimeLabel(s.lead_time_min_days, s.lead_time_max_days)
                    ? ` · despacho en ${leadTimeLabel(s.lead_time_min_days, s.lead_time_max_days)}`
                    : ""}
                </p>
              </div>
              <p className="text-sm text-fg-muted">
                {s.last_synced_at
                  ? `Última actualización: ${date.format(new Date(s.last_synced_at))}`
                  : "Sin disponibilidad capturada"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
