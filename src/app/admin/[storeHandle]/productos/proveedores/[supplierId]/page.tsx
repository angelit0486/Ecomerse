import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { centsToInput } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { listSupplierVariants, listSuppliers } from "@/server/catalog/suppliers";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { SupplierForm, SupplierVariantForm, UnlinkVariantButton } from "../forms";
import { AVAILABILITY_LABELS } from "../labels";

export const metadata: Metadata = { title: "Proveedor" };

type Props = { params: Promise<{ storeHandle: string; supplierId: string }> };

export default async function SupplierPage({ params }: Props) {
  const { storeHandle, supplierId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "products.cost.read") || !/^[0-9a-f-]{36}$/.test(supplierId)) notFound();
  const supabase = await createSupabaseServerClient();
  const supplier = (await listSuppliers(supabase, ctx.store.id)).find((s) => s.id === supplierId);
  if (!supplier) notFound();
  const variants = await listSupplierVariants(supabase, ctx.store.id, supplierId);
  const canEdit = hasPermission(ctx, "products.update");
  const canStock = canEdit && hasPermission(ctx, "inventory.adjust");
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });
  const base = `/admin/${ctx.store.handle}`;

  return (
    <section className="space-y-6">
      <header>
        <Link href={`${base}/productos/proveedores`} className="text-sm underline">
          ← Proveedores
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{supplier.name}</h1>
        <p className="text-sm text-fg-muted">
          Captura manual (sin conexión automática con el proveedor).
        </p>
      </header>

      {canEdit ? <SupplierForm storeHandle={ctx.store.handle} supplier={supplier} /> : null}

      <section aria-labelledby="variantes" className="space-y-3">
        <h2 id="variantes" className="font-semibold">
          Variantes que surte
        </h2>
        {canStock ? (
          <div className="rounded-md border border-border p-4">
            <SupplierVariantForm storeHandle={ctx.store.handle} supplierId={supplier.id} />
          </div>
        ) : null}
        {variants.length === 0 ? (
          <p className="text-sm text-fg-muted">Aún no hay variantes vinculadas.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {variants.map((v) => {
              const label = `${v.product_title}${v.option_signature ? ` (${v.option_signature.replaceAll("|", ", ").replaceAll("=", ": ")})` : ""}`;
              return (
                <li key={v.variant_id} className="space-y-2 p-4">
                  <p className="text-sm">
                    <Link
                      href={`${base}/productos/${v.product_id}`}
                      className="font-medium underline"
                    >
                      {label}
                    </Link>{" "}
                    <span className="text-fg-muted">· SKU {v.sku ?? "—"}</span>
                  </p>
                  <p className="text-sm">
                    {AVAILABILITY_LABELS[v.availability]}
                    {v.reported_quantity !== null ? ` · ${v.reported_quantity} informadas` : ""} ·
                    en venta {Math.max((v.on_hand ?? 0) - (v.reserved ?? 0), 0)}, reservadas{" "}
                    {v.reserved ?? 0}
                    {v.unit_cost !== null ? ` · costo $${centsToInput(v.unit_cost)}` : ""}
                    {v.last_synced_at
                      ? ` · actualizado ${date.format(new Date(v.last_synced_at))}`
                      : ""}
                  </p>
                  {canStock && v.sku ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <SupplierVariantForm
                        storeHandle={ctx.store.handle}
                        supplierId={supplier.id}
                        initial={{
                          sku: v.sku,
                          supplier_sku: v.supplier_sku ?? "",
                          unit_cost: v.unit_cost !== null ? centsToInput(v.unit_cost) : "",
                          availability: v.availability,
                          quantity: v.reported_quantity?.toString() ?? "",
                        }}
                      />
                      <UnlinkVariantButton
                        storeHandle={ctx.store.handle}
                        supplierId={supplier.id}
                        variantId={v.variant_id}
                        label={label}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
