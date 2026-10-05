import type { Metadata } from "next";

import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

export const metadata: Metadata = { title: "Tus tiendas" };

interface MyStore {
  store_id: string;
  organization_name: string;
  name: string;
  handle: string;
  status: string;
}

export default async function AdminHomePage() {
  const supabase = await createSupabaseServerClient();
  const stores = await callRpc<MyStore[]>(supabase, "access_list_my_stores");
  if (stores.length === 0) {
    return (
      <EmptyState
        title="Todavía no tienes tiendas"
        description="Cuando alguien te invite a una tienda, aparecerá aquí."
      />
    );
  }
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Tus tiendas</h1>
      <ul className="divide-y rounded-md border">
        {stores.map((s) => (
          <li key={s.store_id} className="flex items-center justify-between px-4 py-3">
            <span>
              <span className="font-medium">{s.name}</span>
              <span className="block text-[13px] text-fg-muted">{s.organization_name}</span>
            </span>
            <span className="text-[13px] text-fg-muted">{s.handle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
