import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { callRpc } from "@/server/db/rpc";

/**
 * Atributos filtrables para el panel (R-T04, ADR-022), con la sesión del
 * usuario: las RPC comprueban products.read. Nada se cachea entre requests (§44.7).
 */
export interface AttributeValueRow {
  id: string;
  key: string;
  label: string;
  position: number;
  /** Productos (no eliminados) que lo llevan. */
  products: number;
}

export interface AttributeRow {
  id: string;
  key: string;
  name: string;
  is_filterable: boolean;
  position: number;
  /** Productos (no eliminados) con algún valor del atributo. */
  products: number;
  values: AttributeValueRow[];
}

export async function listAttributes(
  supabase: SupabaseClient,
  storeId: string,
): Promise<AttributeRow[]> {
  return (
    (await callRpc<AttributeRow[] | null>(supabase, "catalog_list_attributes", {
      p_store_id: storeId,
    })) ?? []
  );
}

export async function getProductAttributeValues(
  supabase: SupabaseClient,
  storeId: string,
  productId: string,
): Promise<string[]> {
  return (
    (await callRpc<string[] | null>(supabase, "catalog_product_attribute_values", {
      p_store_id: storeId,
      p_product_id: productId,
    })) ?? []
  );
}
