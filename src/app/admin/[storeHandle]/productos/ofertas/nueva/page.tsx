import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ScheduleSaleForm } from "../../product-sales";

export const metadata: Metadata = { title: "Programar oferta" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ ids?: string | string[] }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Oferta en bloque para los productos elegidos en el listado (ADR-030). */
export default async function NewSalePage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.update")) notFound();
  const raw = (await searchParams).ids;
  const ids = [
    ...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id) => UUID.test(id))),
  ];
  const base = `/admin/${ctx.store.handle}/productos`;
  const supabase = await createSupabaseServerClient();
  const { data, error } = ids.length
    ? await supabase
        .from("products")
        .select("id, title")
        .eq("store_id", ctx.store.id)
        .is("deleted_at", null)
        .in("id", ids.slice(0, 100))
        .order("title")
    : { data: [], error: null };
  if (error) throw error;
  const products = (data ?? []) as { id: string; title: string }[];
  return (
    <section className="space-y-5">
      <header>
        <Link href={base} className="inline-flex min-h-11 items-center text-sm underline">
          ← Productos
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Programar oferta</h1>
      </header>
      {products.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Selecciona productos en el listado y elige «Programar oferta…».
        </p>
      ) : (
        <>
          <p className="text-sm">
            Para {products.length === 1 ? "1 producto" : `${products.length} productos`} (todas sus
            presentaciones): {products.map((p) => p.title).join(", ")}.
          </p>
          <ScheduleSaleForm
            storeHandle={ctx.store.handle}
            productIds={products.map((p) => p.id)}
            currency={ctx.store.currency}
            timeZone={ctx.store.timezone}
            timeZoneLabel={ctx.store.timezone.replace(/^America\//, "").replace(/_/g, " ")}
          />
          <p className="text-sm">
            <Link href={`${base}/ofertas`} className="underline">
              Ver todas las ofertas
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
