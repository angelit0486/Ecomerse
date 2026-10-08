import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoney } from "@/lib/money/format";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { EmptyState } from "@/ui/primitives/empty-state";

import { searchCustomers } from "./actions";
import { SEARCH_COOKIE } from "./search";

export const metadata: Metadata = { title: "Clientes" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export interface CustomerRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  has_account: boolean;
  accepts_marketing: boolean;
  orders_count: number;
  total_spent: number;
  anonymized: boolean;
  created_at: string;
  masked: boolean;
}

/** Clientes (F8-T02): sin customers.pii.read todo sale enmascarado y no hay búsqueda. */
export default async function CustomersPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "customers.read")) notFound();
  const canSearch = hasPermission(ctx, "customers.pii.read");
  const sp = await searchParams;
  // La búsqueda viaja en una cookie de esta página, no en la URL (APP-L8).
  const q = canSearch ? ((await cookies()).get(SEARCH_COOKIE)?.value ?? "").slice(0, 100) : "";
  const cursor = typeof sp.despues === "string" ? sp.despues.slice(0, 80) : null;
  const supabase = await createSupabaseServerClient();
  const page = await callRpc<{ items: CustomerRow[]; next_cursor: string | null }>(
    supabase,
    "customers_list",
    { p_store_id: ctx.store.id, p_query: q || null, p_cursor: cursor, p_limit: 50 },
  ).catch(() => ({ items: [] as CustomerRow[], next_cursor: null }));
  const base = `/admin/${ctx.store.handle}/clientes`;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Clientes</h1>
        {!canSearch ? (
          <p className="text-sm text-fg-muted">
            Los datos personales aparecen ocultos: tu rol no incluye verlos.
          </p>
        ) : null}
      </header>
      {canSearch ? (
        <form
          action={searchCustomers.bind(null, ctx.store.handle)}
          role="search"
          className="flex max-w-md gap-2"
        >
          <label htmlFor="q" className="sr-only">
            Buscar por email o nombre
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Buscar por email o nombre"
            className="h-9 flex-1 rounded-[var(--radius-control)] border border-control bg-surface px-2 text-sm"
          />
          <button type="submit" className="h-9 rounded-md border border-control px-3 text-sm">
            Buscar
          </button>
        </form>
      ) : null}
      {q ? (
        <p className="text-sm text-fg-muted">
          Resultados de la búsqueda. Para ver todos, deja el buscador vacío y pulsa Buscar.
        </p>
      ) : null}
      {page.items.length === 0 ? (
        <EmptyState
          title="Sin clientes"
          description="Aparecen cuando alguien compra en tu tienda."
        />
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-[13px] text-fg-muted">
            <tr>
              <th className="py-2 font-medium">Cliente</th>
              <th className="py-2 font-medium">Pedidos</th>
              <th className="py-2 font-medium">Total comprado</th>
              <th className="py-2 font-medium">Cuenta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {page.items.map((c) => (
              <tr key={c.id}>
                <td className="py-2">
                  <Link href={`${base}/${c.id}`} className="underline">
                    {c.anonymized ? "Cliente anonimizado" : (c.name ?? c.email)}
                  </Link>
                  {!c.anonymized && c.name ? (
                    <span className="block text-[13px] text-fg-muted">{c.email}</span>
                  ) : null}
                </td>
                <td className="py-2">{c.orders_count}</td>
                <td className="py-2">{formatMoney(c.total_spent, ctx.store.currency)}</td>
                <td className="py-2">{c.has_account ? "Sí" : "Invitado"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page.next_cursor ? (
        <Link
          href={`${base}?${new URLSearchParams({ despues: page.next_cursor })}`}
          className="text-sm underline"
        >
          Siguientes
        </Link>
      ) : null}
    </section>
  );
}
