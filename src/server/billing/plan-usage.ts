import { cache } from "react";

import { billingSchema, type Billing } from "@/lib/billing/entitlements";
import type { StoreContext } from "@/server/auth/context";
import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Quién ve el plan de la organización (org.billing.read, GATE0 §19.4). */
export function canSeePlan(ctx: StoreContext): boolean {
  return ctx.orgRole === "org_owner" || ctx.orgRole === "org_admin";
}

/**
 * Plan, estado y uso de la organización de la tienda. Una vez por request
 * (layout y página comparten la lectura). `null` si no hay permiso o si la base
 * aún no tiene la migración de la Fase 10: el panel nunca se cae por esto.
 */
export const loadPlanUsage = cache(async (storeId: string): Promise<Billing | null> => {
  try {
    const supabase = await createSupabaseServerClient();
    const raw = await callRpc(supabase, "org_plan_usage", { p_store_id: storeId });
    const parsed = billingSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
});
