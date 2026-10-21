import "server-only";

import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** Otras tiendas de la misma organización a las que esta persona tiene acceso. */
export async function loadSiblingStores(storeId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const stores = await callRpc<{ store_id: string; organization_id: string; name: string }[]>(
    supabase,
    "access_list_my_stores",
  );
  const org = stores.find((s) => s.store_id === storeId)?.organization_id;
  return stores
    .filter((s) => s.organization_id === org && s.store_id !== storeId)
    .map((s) => ({ id: s.store_id, name: s.name }));
}
