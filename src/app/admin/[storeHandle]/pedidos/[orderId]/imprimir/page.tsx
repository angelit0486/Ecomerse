import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../../_shared/panel-flags";
import { loadPackingSlips } from "../../_print/load-slips";
import { PackingSlips } from "../../_print/packing-slips";
import { PrintButton } from "../../_print/print-button";

export const metadata: Metadata = { title: "Nota de empaque" };

type Props = { params: Promise<{ storeHandle: string; orderId: string }> };

/** Nota de empaque de un pedido (interruptor order_printing). */
export default async function PackingSlipPage({ params }: Props) {
  const { storeHandle, orderId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "orders.read") || !/^[0-9a-f-]{36}$/.test(orderId)) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "order_printing"))) notFound();
  const slips = await loadPackingSlips(
    supabase,
    ctx.store.id,
    [orderId],
    hasPermission(ctx, "customers.pii.read"),
  );
  const slip = slips[0];
  if (!slip) notFound();
  return (
    <section className="space-y-4">
      <div data-print-hide className="space-y-3">
        <Link
          href={`/admin/${ctx.store.handle}/pedidos/${orderId}`}
          className="inline-flex min-h-11 items-center underline"
        >
          ← Pedido {slip.number}
        </Link>
        <h1 className="text-xl font-semibold">Nota de empaque</h1>
        <PrintButton label="Imprimir nota de empaque" />
      </div>
      <PackingSlips storeName={ctx.store.name} slips={slips} timeZone={ctx.store.timezone} />
    </section>
  );
}
