import { notFound } from "next/navigation";

import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { CreateTenantForm } from "../../console-forms";

export const metadata = { title: "Nueva organización" };

export default async function NewTenantPage() {
  if (!canManageTenants(await requirePlatformRole())) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: plans } = await supabase
    .from("plans")
    .select("key, name")
    .eq("status", "active")
    .order("name");
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Nueva organización y tienda</h1>
        <p className="text-sm text-fg-muted">
          La tienda nace en borrador. El dueño recibe una invitación y activa la verificación en dos
          pasos al entrar.
        </p>
      </header>
      <CreateTenantForm plans={(plans ?? []).map((p) => ({ value: p.key, label: p.name }))} />
    </section>
  );
}
