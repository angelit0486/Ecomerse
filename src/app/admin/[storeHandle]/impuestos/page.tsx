import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { TaxForm } from "./tax-form";

export const metadata: Metadata = { title: "Impuestos" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function TaxesPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stores")
    .select("prices_include_tax, tax_rate_bps, tax_applies_to_shipping")
    .eq("id", ctx.store.id)
    .single();
  if (error) throw error;
  const bps = data.tax_rate_bps as number;
  const rate = bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(2);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Impuestos</h1>
        <p className="text-sm text-fg-muted">
          Una tasa para toda la tienda. Revisa con tu contador la tasa que te corresponde: aquí no
          se asume ninguna.
        </p>
      </header>
      <TaxForm
        storeHandle={ctx.store.handle}
        initial={{
          rate,
          include: data.prices_include_tax as boolean,
          shipping: data.tax_applies_to_shipping as boolean,
        }}
        canEdit={hasPermission(ctx, "taxes.manage")}
      />
    </section>
  );
}
