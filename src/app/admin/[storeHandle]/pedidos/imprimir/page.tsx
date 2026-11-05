import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../_shared/panel-flags";
import { loadPackingSlips } from "../_print/load-slips";
import { PackingSlips } from "../_print/packing-slips";
import { PrintButton } from "../_print/print-button";

export const metadata: Metadata = { title: "Notas de empaque" };

/** Como mucho una tanda por impresión: las más antiguas primero, como «Por surtir». */
const BATCH = 50;

type Props = { params: Promise<{ storeHandle: string }> };

/** Notas de empaque de los pedidos por surtir (interruptor order_printing). */
export default async function PackingSlipsBatchPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read")) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "order_printing"))) notFound();
  // La misma definición que «Por surtir» de la lista y de los avisos.
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("store_id", ctx.store.id)
    .eq("status", "open")
    .in("fulfillment_status", ["unfulfilled", "partially_fulfilled"])
    .order("placed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(BATCH + 1);
  if (error) throw error;
  const ids = (data ?? []).map((o) => o.id as string);
  const more = ids.length > BATCH;
  const slips = await loadPackingSlips(
    supabase,
    ctx.store.id,
    ids.slice(0, BATCH),
    hasPermission(ctx, "customers.pii.read"),
  );
  return (
    <section className="space-y-4">
      <div data-print-hide className="space-y-3">
        <Link
          href={`/admin/${ctx.store.handle}/pedidos?estado=por-surtir`}
          className="inline-flex min-h-11 items-center underline"
        >
          ← Por surtir
        </Link>
        <h1 className="text-xl font-semibold">Notas de empaque ({slips.length})</h1>
        {slips.length === 0 ? (
          <p>No hay pedidos por surtir.</p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              Cada nota sale en su propia hoja, de la más antigua a la más reciente.
              {more
                ? ` Se muestran las primeras ${BATCH}; al surtirlas, imprime las siguientes.`
                : ""}
            </p>
            <PrintButton label={`Imprimir ${slips.length} nota${slips.length === 1 ? "" : "s"}`} />
          </>
        )}
      </div>
      <PackingSlips storeName={ctx.store.name} slips={slips} timeZone={ctx.store.timezone} />
    </section>
  );
}
