import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** ¿Está encendido este interruptor para la tienda? Si la lectura falla, apagado. */
export async function panelFlagEnabled(
  supabase: SupabaseClient,
  storeId: string,
  key: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("access_store_flags", { p_store_id: storeId });
  if (error || !Array.isArray(data)) return false;
  return (data as { key: string; enabled: boolean }[]).some((f) => f.key === key && f.enabled);
}
