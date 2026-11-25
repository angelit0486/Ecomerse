import "server-only";

import type { PromotionScope } from "@/lib/promotions/form";
import type { PromotionType } from "@/lib/promotions/rules";
import type { StoreContext } from "@/server/auth/context";
import { canSeePlan, loadPlanUsage } from "@/server/billing/plan-usage";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type PromotionStatus = "draft" | "active" | "paused" | "archived";

export interface PromotionRow {
  id: string;
  name: string;
  label: string;
  type: PromotionType;
  rules: unknown;
  scope: PromotionScope;
  applies_to_sale_items: boolean;
  starts_at: string | null;
  ends_at: string | null;
  status: PromotionStatus;
  created_at: string;
  promotion_targets: { product_id: string | null; category_id: string | null }[];
}

const COLUMNS =
  "id, name, label, type, rules, scope, applies_to_sale_items, starts_at, ends_at, status, created_at, promotion_targets(product_id, category_id)";

export async function loadPromotions(storeId: string): Promise<PromotionRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("promotions")
    .select(COLUMNS)
    .eq("store_id", storeId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PromotionRow[];
}

export async function loadPromotion(storeId: string, id: string): Promise<PromotionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("promotions")
    .select(COLUMNS)
    .eq("store_id", storeId)
    .eq("id", id)
    .neq("status", "archived")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as PromotionRow | null) ?? null;
}

export interface TargetOptions {
  products: { id: string; title: string }[];
  categories: { id: string; name: string; depth: number }[];
  truncated: boolean;
}

const PRODUCT_CAP = 2000;

/** Productos y categorías para elegir a qué aplica (si no hay permiso de catálogo, listas vacías). */
export async function loadTargetOptions(storeId: string): Promise<TargetOptions> {
  const supabase = await createSupabaseServerClient();
  const [products, categories] = await Promise.all([
    supabase
      .from("products")
      .select("id, title")
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .order("title")
      .limit(PRODUCT_CAP + 1),
    supabase
      .from("categories")
      .select("id, name, depth, path")
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .order("path"),
  ]);
  const p = (products.data ?? []) as { id: string; title: string }[];
  return {
    products: p.slice(0, PRODUCT_CAP),
    categories: ((categories.data ?? []) as { id: string; name: string; depth: number }[]).map(
      ({ id, name, depth }) => ({ id, name, depth }),
    ),
    truncated: p.length > PRODUCT_CAP,
  };
}

/** Límite de promociones activas del plan (solo si quien entra puede ver el plan). */
export async function loadPromotionLimit(
  ctx: StoreContext,
): Promise<{ limit: number; used: number; plan: string | null } | null> {
  if (!canSeePlan(ctx)) return null;
  const billing = await loadPlanUsage(ctx.store.id);
  const e = billing?.entitlements?.max_active_promotions;
  if (!billing || !e || typeof e.value !== "number") return null;
  return { limit: e.value, used: e.used ?? 0, plan: billing.plan?.name ?? null };
}
