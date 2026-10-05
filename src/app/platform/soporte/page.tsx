import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { Table, TBody, TD, TH, THead, TR } from "@/ui/primitives/table";

import { GrantSupportForm, RevokeButton } from "../console-forms";

export const metadata = { title: "Soporte" };

interface GrantRow {
  id: string;
  organization: string;
  store_name: string;
  grantee_email: string;
  granted_by: string | null;
  reason: string;
  expires_at: string;
}

const time = new Intl.DateTimeFormat("es-MX", { timeStyle: "short", dateStyle: "short" });

export default async function SupportPage() {
  const role = await requirePlatformRole();
  const manage = canManageTenants(role);
  const supabase = await createSupabaseServerClient();
  const grants = await callRpc<GrantRow[]>(supabase, "platform_list_support_grants", {
    p_active_only: true,
  });
  const [stores, staff] = manage
    ? await Promise.all([
        callRpc<{ id: string; organization: string; name: string; status: string }[]>(
          supabase,
          "platform_list_stores",
        ),
        callRpc<{ user_id: string; email: string }[]>(supabase, "platform_list_support_staff"),
      ])
    : [[], []];

  return (
    <section className="space-y-8">
      <h1 className="text-xl font-semibold">Accesos de soporte</h1>
      <Table caption="Accesos vigentes (solo lectura, máximo 60 minutos)">
        <THead>
          <TR>
            <TH>Tienda</TH>
            <TH>Soporte</TH>
            <TH>Motivo</TH>
            <TH>Vence</TH>
            <TH>Acciones</TH>
          </TR>
        </THead>
        <TBody>
          {grants.length === 0 ? (
            <TR>
              <TD colSpan={5} className="text-fg-muted">
                No hay accesos vigentes.
              </TD>
            </TR>
          ) : (
            grants.map((g) => (
              <TR key={g.id}>
                <TD>
                  <span className="block font-medium">{g.store_name}</span>
                  <span className="text-[13px] text-fg-muted">{g.organization}</span>
                </TD>
                <TD>{g.grantee_email}</TD>
                <TD className="max-w-xs">{g.reason}</TD>
                <TD>{time.format(new Date(g.expires_at))}</TD>
                <TD>
                  <RevokeButton grantId={g.id} />
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
      {manage ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Conceder acceso</h2>
          <GrantSupportForm
            stores={stores
              .filter((s) => s.status !== "closed")
              .map((s) => ({ value: s.id, label: `${s.name} · ${s.organization}` }))}
            staff={staff.map((s) => ({ value: s.user_id, label: s.email }))}
          />
        </section>
      ) : null}
    </section>
  );
}
