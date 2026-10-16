import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { callRpc } from "@/server/db/rpc";

/**
 * Proveedores y su disponibilidad (ADR-025). Datos comerciales sensibles: las
 * RPC exigen products.cost.read. Nada se cachea entre requests (§44.7).
 */
export type SupplierAvailability = "available" | "limited" | "unavailable" | "unknown";

export interface Supplier {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  shipping_terms: string | null;
  adapter: "manual";
  variants: number;
  last_synced_at: string | null;
}

export interface SupplierVariant {
  variant_id: string;
  product_id: string;
  product_title: string;
  option_signature: string;
  sku: string | null;
  supplier_sku: string | null;
  unit_cost: number | null;
  availability: SupplierAvailability;
  reported_quantity: number | null;
  last_synced_at: string | null;
  sync_source: "manual" | "csv" | "adapter";
  on_hand: number | null;
  reserved: number | null;
}

export function listSuppliers(supabase: SupabaseClient, storeId: string): Promise<Supplier[]> {
  return callRpc<Supplier[]>(supabase, "suppliers_list", { p_store_id: storeId });
}

export function listSupplierVariants(
  supabase: SupabaseClient,
  storeId: string,
  supplierId: string,
): Promise<SupplierVariant[]> {
  return callRpc<SupplierVariant[]>(supabase, "suppliers_variants", {
    p_store_id: storeId,
    p_supplier_id: supplierId,
  });
}
