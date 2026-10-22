import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { TIMEZONES } from "../../_shared/timezones";
import { ProfileForm } from "../../configuracion/forms";

export const metadata: Metadata = { title: "Datos de la tienda" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Nombre, contacto y zona horaria de la tienda, también cuando ya está abierta
 * («Configurar tienda» solo aparece en el menú mientras es borrador).
 */
export default async function StoreDataPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.update")) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: store, error } = await supabase
    .from("stores")
    .select("name, contact_email, contact_phone, timezone")
    .eq("id", ctx.store.id)
    .single();
  if (error) throw error;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Datos de la tienda</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          El nombre se ve en el encabezado y el pie de tu tienda, en los correos a tus clientes y en
          el selector de tiendas del panel. La dirección ({ctx.store.handle}) no cambia.
        </p>
      </header>
      <ProfileForm
        storeHandle={ctx.store.handle}
        initial={{
          name: store.name as string,
          contact_email: (store.contact_email as string | null) ?? "",
          contact_phone: (store.contact_phone as string | null) ?? "",
          timezone: store.timezone as string,
        }}
        timezones={
          TIMEZONES.includes(store.timezone as string)
            ? TIMEZONES
            : [store.timezone as string, ...TIMEZONES]
        }
      />
    </section>
  );
}
