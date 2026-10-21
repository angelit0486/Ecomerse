import type { Metadata } from "next";
import Link from "next/link";

import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { STORE_STATUS_SHORT } from "./_shared/store-status";

export const metadata: Metadata = { title: "Tus tiendas" };

interface MyStore {
  store_id: string;
  organization_id: string;
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
    <Link href="/platform" className="inline-flex min-h-11 items-center text-sm underline">
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
  // Una sola entrada por organización para agregar otra tienda (la crea la plataforma).
  const organizations = [
    ...new Map(stores.map((s) => [s.organization_id, s.organization_name])).entries(),
  ];
  return (
    <section className="space-y-4">
      {consoleLink}
      <h1 className="text-xl font-semibold">Tus tiendas</h1>
      <ul
        aria-label="Tus tiendas"
        className="divide-y divide-border rounded-md border border-border"
      >
        {stores.map((s) => (
          <li
            key={s.store_id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <Link href={`/admin/${s.handle}`} className="min-h-11 py-1">
              <span className="font-medium underline">{s.name}</span>
              <span className="block text-[13px] text-fg-muted">
                {s.organization_name} · {s.handle}
              </span>
            </Link>
            <span className="rounded-sm border border-border px-2 py-0.5 text-[13px]">
              {STORE_STATUS_SHORT[s.status] ?? s.status}
            </span>
          </li>
        ))}
      </ul>
      {platformRole ? (
        <ul aria-label="Agregar tienda" className="flex flex-wrap gap-x-6">
          {organizations.map(([id, name]) => (
            <li key={id}>
              <Link
                href={`/platform/organizaciones/${id}/tienda-nueva`}
                className="inline-flex min-h-11 items-center text-sm underline"
              >
                Agregar otra tienda a {name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">
          ¿Necesitas otra tienda, por ejemplo para otra marca? La activa el equipo de la plataforma
          y aparecerá aquí y en el selector de tiendas.
        </p>
      )}
    </section>
  );
}
