import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { centsToInput, formatMoney } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { DiscountForm, StatusButtons } from "./forms";

export const metadata: Metadata = { title: "Descuentos" };

type Props = { params: Promise<{ storeHandle: string }> };

interface Row {
  id: string;
  code: string;
  type: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  min_subtotal: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  usage_limit_per_customer: number | null;
  times_used: number;
  times_reserved: number;
  status: string;
}

const STATUS: Record<string, string> = { active: "Activo", disabled: "Desactivado" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default async function DiscountsPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "discounts.read")) notFound();
  const canEdit = hasPermission(ctx, "discounts.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("discounts")
    .select(
      "id, code, type, value, min_subtotal, starts_at, ends_at, usage_limit, usage_limit_per_customer, times_used, times_reserved, status",
    )
    .eq("store_id", ctx.store.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const { currency } = ctx.store;
  const describe = (r: Row) =>
    r.type === "percentage"
      ? `${r.value / 100} %`
      : r.type === "fixed_amount"
        ? formatMoney(r.value, currency)
        : "Envío gratis";

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Descuentos</h1>
        <p className="text-sm text-fg-muted">
          Códigos que el comprador escribe en el carrito. Un uso se aparta al hacer el pedido y se
          confirma con el pago; si el pago vence, se libera.
        </p>
      </header>
      {canEdit ? <DiscountForm storeHandle={ctx.store.handle} currency={currency} /> : null}
      {rows.length === 0 ? (
        <EmptyState
          title="Aún no tienes descuentos"
          description="Crea un código para tus clientes."
        />
      ) : (
        <ul className="space-y-4" aria-label="Descuentos">
          {rows.map((r) => (
            <li key={r.id} className="space-y-3 rounded-md border border-border p-4">
              <p className="text-sm">
                <strong>{r.code}</strong> · {describe(r)} · {STATUS[r.status] ?? r.status} · usado{" "}
                {r.times_used}
                {r.usage_limit ? ` de ${r.usage_limit}` : ""}
                {r.times_reserved ? ` (${r.times_reserved} apartados)` : ""}
              </p>
              {canEdit ? (
                <>
                  <DiscountForm
                    storeHandle={ctx.store.handle}
                    currency={currency}
                    discount={{
                      id: r.id,
                      code: r.code,
                      type: r.type,
                      value:
                        r.type === "percentage"
                          ? String(r.value / 100)
                          : r.type === "fixed_amount"
                            ? centsToInput(r.value)
                            : "",
                      min_subtotal: r.min_subtotal ? centsToInput(r.min_subtotal) : "",
                      starts_at: day(r.starts_at),
                      ends_at: day(r.ends_at),
                      usage_limit: r.usage_limit?.toString() ?? "",
                      usage_limit_per_customer: r.usage_limit_per_customer?.toString() ?? "",
                    }}
                  />
                  <StatusButtons
                    storeHandle={ctx.store.handle}
                    id={r.id}
                    status={r.status}
                    code={r.code}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
