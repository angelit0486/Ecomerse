import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AddStoreForm } from "../../../console-forms";

export const metadata = { title: "Agregar tienda" };

interface OrgRow {
  id: string;
  name: string;
  status: string;
  store_count: number;
  owner_email: string | null;
}

/** Otra tienda en una organización existente (GATE0 §2: STORE ×N por max_stores). */
export default async function AddStorePage({ params }: { params: Promise<{ orgId: string }> }) {
  if (!canManageTenants(await requirePlatformRole())) notFound();
  const { orgId } = await params;
  if (!z.uuid().safeParse(orgId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const orgs = await callRpc<OrgRow[]>(supabase, "platform_list_organizations", {
    p_search: null,
  });
  const org = orgs.find((o) => o.id === orgId);
  if (!org) notFound();

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <Link
          href="/platform"
          className="inline-flex min-h-11 items-center text-sm underline sm:min-h-9"
        >
          ← Organizaciones
        </Link>
        <h1 className="text-xl font-semibold">Agregar tienda a {org.name}</h1>
        <p className="text-sm text-fg-muted">
          Hoy tiene {org.store_count === 1 ? "1 tienda" : `${org.store_count} tiendas`}. La nueva
          nace en borrador y{" "}
          {org.owner_email ? `${org.owner_email} la administra` : "la dueña la administra"} desde el
          mismo panel, con el selector de tiendas. El plan limita cuántas puede tener.
        </p>
      </header>
      {org.status === "active" ? (
        <AddStoreForm organizationId={org.id} />
      ) : (
        <p role="alert" className="text-sm text-danger">
          La organización no está activa: reactívala antes de agregar tiendas.
        </p>
      )}
    </section>
  );
}
