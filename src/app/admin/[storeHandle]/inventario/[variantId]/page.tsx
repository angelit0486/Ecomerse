import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { MOVEMENT_LABELS, variantLabel } from "../labels";

export const metadata: Metadata = { title: "Historial de inventario" };

type Props = { params: Promise<{ storeHandle: string; variantId: string }> };

interface Movement {
  id: string;
  type: string;
  on_hand_delta: number;
  reserved_delta: number;
  on_hand_after: number;
  reserved_after: number;
  reason: string | null;
  reference_type: string | null;
  actor_type: string;
  created_at: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export default async function InventoryHistoryPage({ params }: Props) {
  const { storeHandle, variantId } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "inventory.read") || !/^[0-9a-f-]{36}$/.test(variantId)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: variant } = await supabase
    .from("product_variants")
    .select("id, sku, option_signature, products(title)")
    .eq("store_id", ctx.store.id)
    .eq("id", variantId)
    .maybeSingle();
  const { data: level } = await supabase
    .from("inventory_levels")
    .select("id, on_hand, reserved, available")
    .eq("store_id", ctx.store.id)
    .eq("variant_id", variantId)
    .maybeSingle();
  if (!variant || !level) notFound();

  const { data: movements } = await supabase
    .from("inventory_movements")
    .select(
      "id, type, on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, reference_type, actor_type, created_at",
    )
    .eq("store_id", ctx.store.id)
    .eq("level_id", level.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const product = (variant.products as unknown as { title: string } | null)?.title ?? "";
  const label = [product, variantLabel(variant.option_signature)].filter(Boolean).join(" · ");
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.store.timezone,
  });

  return (
    <section className="space-y-5">
      <header>
        <Link href={`/admin/${ctx.store.handle}/inventario`} className="text-sm underline">
          ← Inventario
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Historial: {label}</h1>
        <p className="text-sm text-fg-muted">
          {variant.sku ? `${variant.sku} · ` : ""}
          {level.on_hand} en mano, {level.reserved} reservado, {level.available} disponible. Los
          movimientos no se editan ni se borran.
        </p>
      </header>
      {(movements ?? []).length === 0 ? (
        <EmptyState
          title="Sin movimientos"
          description="Cuando ajustes existencias o se venda esta variante, cada cambio aparecerá aquí."
        />
      ) : (
        <Table caption={`Movimientos de ${label}, del más reciente al más antiguo`}>
          <THead>
            <TR>
              <TH>Fecha</TH>
              <TH>Movimiento</TH>
              <TH>En mano</TH>
              <TH>Reservado</TH>
              <TH>Motivo</TH>
              <TH>Por</TH>
            </TR>
          </THead>
          <TBody>
            {((movements ?? []) as Movement[]).map((m) => (
              <TR key={m.id}>
                <TD>{date.format(new Date(m.created_at))}</TD>
                <TD>{MOVEMENT_LABELS[m.type] ?? m.type}</TD>
                <TD>
                  {m.on_hand_delta !== 0 ? `${signed(m.on_hand_delta)} → ` : ""}
                  {m.on_hand_after}
                </TD>
                <TD>
                  {m.reserved_delta !== 0 ? `${signed(m.reserved_delta)} → ` : ""}
                  {m.reserved_after}
                </TD>
                <TD>{m.reason ?? "—"}</TD>
                <TD>{m.actor_type === "user" ? "Equipo" : "Sistema"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
