import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SupplierOrderStatus } from "@/lib/orders/supplier-order-status";
import { callRpc } from "@/server/db/rpc";

/**
 * Despachos por proveedor (ADR-025 paso 2). Se leen con orders.read; nunca
 * incluyen costos. Nada se cachea entre requests (§44.7).
 */
export interface SupplierOrder {
  id: string;
  order_id: string;
  status: SupplierOrderStatus;
  supplier: {
    id: string;
    name: string;
    adapter: string;
    lead_time_min_days: number | null;
    lead_time_max_days: number | null;
    shipping_terms: string | null;
  };
  order: { display_number: string; status: string; payment_status: string; placed_at: string };
  external_reference: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  note: string | null;
  requested_at: string | null;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  items: {
    variant_id: string | null;
    product_title: string;
    variant_title: string | null;
    sku: string | null;
    supplier_sku: string | null;
    quantity: number;
  }[];
}

export type SupplierOrderFilter = "open" | "all" | SupplierOrderStatus;

export function getOrderSupplierOrders(
  supabase: SupabaseClient,
  storeId: string,
  orderId: string,
): Promise<SupplierOrder[]> {
  return callRpc<SupplierOrder[]>(supabase, "orders_supplier_orders", {
    p_store_id: storeId,
    p_order_id: orderId,
  });
}

export function listSupplierOrders(
  supabase: SupabaseClient,
  storeId: string,
  status: SupplierOrderFilter,
): Promise<{ counts: Partial<Record<SupplierOrderStatus, number>>; items: SupplierOrder[] }> {
  return callRpc(supabase, "supplier_orders_list", { p_store_id: storeId, p_status: status });
}
