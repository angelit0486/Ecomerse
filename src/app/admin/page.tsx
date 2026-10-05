import type { Metadata } from "next";
import Link from "next/link";

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
  const [stores, platformRole] = await Promise.all([
    callRpc<MyStore[]>(supabase, "access_list_my_stores"),
    callRpc<string | null>(supabase, "access_platform_role"),
  ]);
  const consoleLink = platformRole ? (
    <Link href="/platform" className="text-sm underline">
      Ir a la consola de plataforma
    </Link>
  ) : null;
  if (stores.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="Todavía no tienes tiendas"
          description="Cuando alguien te invite a una tienda, aparecerá aquí."
        />
        {consoleLink}
      </div>
    );
  }
  return (
    <section className="space-y-4">
      {consoleLink}
      <h1 className="text-xl font-semibold">Tus tiendas</h1>
      <ul className="divide-y rounded-md border">
        {stores.map((s) => (
          <li key={s.store_id} className="flex items-center justify-between px-4 py-3">
            <Link href={`/admin/${s.handle}`}>
              <span className="font-medium">{s.name}</span>
              <span className="block text-[13px] text-fg-muted">{s.organization_name}</span>
            </Link>
            <span className="text-[13px] text-fg-muted">{s.handle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
