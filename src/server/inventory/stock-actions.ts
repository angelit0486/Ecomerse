import "server-only";

import {
  soldOutKey,
  soldOutPlan,
  type SoldOutResult,
  type StockRow,
} from "@/lib/inventory/sold-out";

export { soldOutMessage } from "@/lib/inventory/sold-out";
import { reportActionError } from "@/server/actions/report";
import { callRpc } from "@/server/db/rpc";
import type { createSupabaseServerClient } from "@/server/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Existencias de la bodega principal de las variantes vivas de unos productos o
 * de unas variantes (RLS: `inventory.read`). Solo lectura.
 */
export async function loadStockRows(
  supabase: Supabase,
  storeId: string,
  by: { productIds: string[] } | { variantIds: string[] },
): Promise<StockRow[]> {
  let q = supabase
    .from("product_variants")
    .select("id, track_inventory, inventory_policy")
    .eq("store_id", storeId)
    .is("deleted_at", null);
  q = "productIds" in by ? q.in("product_id", by.productIds) : q.in("id", by.variantIds);
  const { data: variants, error } = await q;
  if (error) throw error;
  if (!variants || variants.length === 0) return [];
  const { data: location, error: locError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("store_id", storeId)
    .eq("is_default", true)
    .maybeSingle();
  if (locError) throw locError;
  const levels = new Map<string, { on_hand: number; reserved: number }>();
  if (location) {
    const { data, error: levelsError } = await supabase
      .from("inventory_levels")
      .select("variant_id, on_hand, reserved")
      .eq("store_id", storeId)
      .eq("location_id", location.id)
      .in(
        "variant_id",
        variants.map((v) => v.id),
      );
    if (levelsError) throw levelsError;
    for (const l of data ?? []) levels.set(l.variant_id, l);
  }
  return variants.map((v) => ({
    variant_id: v.id,
    track_inventory: v.track_inventory,
    inventory_policy: v.inventory_policy === "continue" ? "continue" : "deny",
    on_hand: levels.get(v.id)?.on_hand ?? 0,
    reserved: levels.get(v.id)?.reserved ?? 0,
  }));
}

/**
 * Deja el disponible en 0 en cada variante (en mano = apartado), por
 * `inventory_adjust` en modo «fijar» con motivo y clave de idempotencia. Una
 * variante que falla no detiene a las demás; se cuenta aparte.
 */
export async function markSoldOut(
  supabase: Supabase,
  storeId: string,
  rows: StockRow[],
  /** Uno por envío (formulario de la fila o acción en bloque). */
  nonce: string,
): Promise<SoldOutResult> {
  const result: SoldOutResult = { marked: 0, already: 0, untracked: 0, keepsSelling: 0, failed: 0 };
  for (const row of rows) {
    const plan = soldOutPlan(row);
    if (plan.kind === "already") {
      result.already += 1;
      continue;
    }
    if (plan.kind === "untracked") {
      result.untracked += 1;
      continue;
    }
    try {
      await callRpc(supabase, "inventory_adjust", {
        p_store_id: storeId,
        p_variant_id: row.variant_id,
        p_type: "adjustment",
        p_quantity: plan.target,
        p_reason: "Marcado como agotado desde el panel",
        p_mode: "set",
        p_idempotency_key: soldOutKey(row, nonce),
      });
      result.marked += 1;
      if (plan.keepsSelling) result.keepsSelling += 1;
    } catch (error) {
      reportActionError("inventory.sold_out", error);
      result.failed += 1;
    }
  }
  return result;
}
