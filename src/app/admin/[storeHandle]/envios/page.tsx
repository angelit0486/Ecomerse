import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { centsToInput } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { DeleteButton, QuickNationalForm, RateForm, ZoneForm } from "./forms";

export const metadata: Metadata = { title: "Envíos" };

type Props = { params: Promise<{ storeHandle: string }> };

interface Zone {
  id: string;
  name: string;
  countries: string[];
  regions: string[] | null;
  shipping_rates: {
    id: string;
    name: string;
    type: "flat" | "free_over" | "pickup";
    price: number;
    free_over_subtotal: number | null;
    est_days_min: number | null;
    est_days_max: number | null;
    is_active: boolean;
    position: number;
  }[];
}

export default async function ShippingPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const canEdit = hasPermission(ctx, "shipping.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("shipping_zones")
    .select(
      "id, name, countries, regions, shipping_rates(id, name, type, price, free_over_subtotal, est_days_min, est_days_max, is_active, position)",
    )
    .eq("store_id", ctx.store.id)
    .order("name");
  if (error) throw error;
  const zones = (data ?? []) as Zone[];
  const h = ctx.store.handle;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Envíos</h1>
        <p className="text-sm text-fg-muted">
          A dónde envías y cuánto cuesta. Cada zona agrupa países y, si quieres, estados; el
          comprador ve las tarifas activas de la zona de su dirección antes de pagar.
        </p>
      </header>
      {canEdit ? (
        <QuickNationalForm
          storeHandle={h}
          currency={ctx.store.currency}
          hasZones={zones.length > 0}
        />
      ) : null}
      {canEdit ? (
        <section aria-labelledby="nueva-zona" className="space-y-2">
          <h2 id="nueva-zona" className="text-base font-semibold">
            {zones.length === 0 ? "O arma tus zonas a la medida" : "Agregar una zona"}
          </h2>
          <p className="text-sm text-fg-muted">
            Por ejemplo, un precio para tu estado y otro para el resto del país. El comprador ve las
            tarifas de la zona de su dirección.
          </p>
          <ZoneForm storeHandle={h} />
        </section>
      ) : null}
      {zones.length === 0 ? (
        <EmptyState
          title="Aún no tienes zonas de envío"
          description="Sin una zona, nadie puede comprar productos que requieren envío."
        />
      ) : (
        <ul className="space-y-6" aria-label="Zonas de envío">
          {zones.map((zone) => (
            <li key={zone.id} className="space-y-4 rounded-md border border-border p-4">
              {canEdit ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1">
                    <ZoneForm storeHandle={h} zone={zone} />
                  </div>
                  <DeleteButton
                    storeHandle={h}
                    kind="zone"
                    id={zone.id}
                    label={`la zona ${zone.name}`}
                  />
                </div>
              ) : (
                <h2 className="font-semibold">
                  {zone.name} · {zone.countries.join(", ")}
                  {zone.regions ? ` (${zone.regions.join(", ")})` : ""}
                </h2>
              )}
              <div className="space-y-4 border-l-2 border-border pl-4">
                {zone.shipping_rates
                  .sort((a, b) => a.position - b.position || a.price - b.price)
                  .map((rate) =>
                    canEdit ? (
                      <div key={rate.id} className="flex flex-wrap items-end gap-3">
                        <div className="flex-1">
                          <RateForm
                            storeHandle={h}
                            zoneId={zone.id}
                            currency={ctx.store.currency}
                            rate={{
                              id: rate.id,
                              zone_id: zone.id,
                              name: rate.name,
                              type: rate.type,
                              price: centsToInput(rate.price),
                              free_over_subtotal: centsToInput(rate.free_over_subtotal),
                              est_days_min: rate.est_days_min?.toString() ?? "",
                              est_days_max: rate.est_days_max?.toString() ?? "",
                              is_active: rate.is_active,
                            }}
                          />
                        </div>
                        <DeleteButton
                          storeHandle={h}
                          kind="rate"
                          id={rate.id}
                          label={`la tarifa ${rate.name}`}
                        />
                      </div>
                    ) : (
                      <p key={rate.id} className="text-sm">
                        {rate.name}
                      </p>
                    ),
                  )}
                {canEdit ? (
                  <RateForm storeHandle={h} zoneId={zone.id} currency={ctx.store.currency} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
