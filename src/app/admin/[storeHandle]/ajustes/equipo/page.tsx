import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { TeamManager, type InvitationRow, type MemberRow, type RoleOption } from "./team-manager";

export const metadata: Metadata = { title: "Equipo" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function TeamPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "staff.read")) notFound();

  const supabase = await createSupabaseServerClient();
  const members = await callRpc<MemberRow[]>(supabase, "access_list_store_members", {
    p_store_id: ctx.store.id,
  });
  const { data: roles } = await supabase
    .from("roles")
    .select("id, key, name, rank")
    .is("organization_id", null)
    .order("rank", { ascending: false });
  const canManage = hasPermission(ctx, "staff.manage");
  const { data: invitations } = canManage
    ? await supabase
        .from("organization_invitations")
        .select("id, email, store_role_id, expires_at")
        .eq("store_id", ctx.store.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };

  // Solo org_owner/org_admin asignan store_admin; un store_admin asigna roles de
  // rango menor (GATE0 §8.3). La base lo vuelve a comprobar en cada acción.
  const orgManager = ctx.orgRole === "org_owner" || ctx.orgRole === "org_admin";
  const assignable: RoleOption[] = (roles ?? [])
    .filter((r) => orgManager || r.rank < 90)
    .map((r) => ({ value: r.key, label: r.name }));

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Equipo</h1>
        <p className="text-sm text-fg-muted">
          Quién puede entrar al panel de {ctx.store.name} y qué puede hacer.
        </p>
      </header>
      <TeamManager
        storeHandle={ctx.store.handle}
        currentUserId={ctx.userId}
        canManage={canManage}
        canResetMfa={orgManager}
        members={members}
        invitations={((invitations ?? []) as Omit<InvitationRow, "expires_label">[]).map((inv) => ({
          ...inv,
          expires_label: new Intl.DateTimeFormat("es-MX", {
            dateStyle: "medium",
            timeZone: ctx.store.timezone,
          }).format(new Date(inv.expires_at)),
        }))}
        roles={assignable}
        roleNames={Object.fromEntries((roles ?? []).map((r) => [r.id, r.name]))}
      />
    </section>
  );
}
