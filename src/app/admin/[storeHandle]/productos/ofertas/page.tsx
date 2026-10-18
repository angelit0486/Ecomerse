import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { SalesList, type SaleRow } from "../product-sales";

export const metadata: Metadata = { title: "Ofertas" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Ofertas con fechas de toda la tienda (ADR-030): las programadas y activas
 * primero, luego las últimas que terminaron.
 */
export default async function SalesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const sales = await callRpc<SaleRow[]>(supabase, "catalog_list_sales", {
    p_store_id: ctx.store.id,
    p_product_id: null,
    p_include_past: true,
    p_limit: 100,
  });
  const base = `/admin/${ctx.store.handle}/productos`;
  return (
    <section className="space-y-5">
      <header>
        <Link href={base} className="text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Ofertas con fechas</h1>
        <p className="text-sm text-fg-muted">
          El precio de oferta se aplica solo a la hora de inicio y el precio regular regresa al
          terminar. Para programar una, abre el producto o selecciona varios en el listado y elige
          «Programar oferta…».
        </p>
      </header>
      <SalesList
        storeHandle={ctx.store.handle}
        sales={sales}
        currency={ctx.store.currency}
        timeZone={ctx.store.timezone}
        canEdit={hasPermission(ctx, "products.update")}
        showProduct
      />
    </section>
  );
}
