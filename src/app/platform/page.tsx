import Link from "next/link";

import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { Input } from "@/ui/primitives/input";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { StatusButton } from "./console-forms";

export const metadata = { title: "Organizaciones" };

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "closed";
  plan_key: string | null;
  subscription_status: string | null;
  store_count: number;
  owner_email: string | null;
}

const STATUS: Record<string, string> = {
  active: "Activa",
  suspended: "Suspendida",
  closed: "Cerrada",
};

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const role = await requirePlatformRole();
  const { q } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const orgs = await callRpc<OrgRow[]>(supabase, "platform_list_organizations", {
    p_search: q ?? null,
  });
  const manage = canManageTenants(role);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-xl font-semibold">Organizaciones</h1>
        {manage ? (
          <Link
            href="/platform/organizaciones/nueva"
            className="inline-flex min-h-11 items-center text-sm underline sm:min-h-9"
          >
            Crear organización y tienda
          </Link>
        ) : null}
      </header>
      <form role="search" className="max-w-sm">
        <label htmlFor="q" className="text-[13px] font-medium">
          Buscar por nombre o slug
        </label>
        <Input id="q" name="q" defaultValue={q ?? ""} />
      </form>
      <Table caption="Organizaciones de la plataforma">
        <THead>
          <TR>
            <TH>Organización</TH>
            <TH>Dueño</TH>
            <TH>Plan</TH>
            <TH>Tiendas</TH>
            <TH>Estado</TH>
            {manage ? <TH>Acciones</TH> : null}
          </TR>
        </THead>
        <TBody>
          {orgs.map((o) => (
            <TR key={o.id}>
              <TD>
                <span className="block font-medium">{o.name}</span>
                <span className="text-[13px] text-fg-muted">{o.slug}</span>
              </TD>
              <TD>{o.owner_email ?? "Invitación pendiente"}</TD>
              <TD>{o.plan_key ?? "—"}</TD>
              <TD>{o.store_count}</TD>
              <TD>{STATUS[o.status]}</TD>
              {manage ? (
                <TD className="space-y-1">
                  {o.status === "active" ? (
                    <Link
                      href={`/platform/organizaciones/${o.id}/tienda-nueva`}
                      className="inline-flex min-h-11 items-center text-sm underline sm:min-h-9"
                    >
                      Agregar tienda
                    </Link>
                  ) : null}
                  {o.status === "active" ? (
                    <StatusButton
                      organizationId={o.id}
                      organizationName={o.name}
                      status="suspended"
                    />
                  ) : o.status === "suspended" ? (
                    <StatusButton organizationId={o.id} organizationName={o.name} status="active" />
                  ) : null}
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
    </section>
  );
}
