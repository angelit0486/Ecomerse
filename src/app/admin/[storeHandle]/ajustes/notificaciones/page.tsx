import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { CartRecoveryForm } from "./cart-recovery-form";
import { NotificationsForm } from "./notifications-form";

export const metadata: Metadata = { title: "Notificaciones" };

type Props = { params: Promise<{ storeHandle: string }> };

export default async function NotificationsSettingsPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "notifications.manage")) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: settings, error }, { data: store }] = await Promise.all([
    supabase
      .from("store_notification_settings")
      .select("staff_emails, notify_new_order, notify_paid, cart_recovery")
      .eq("store_id", ctx.store.id)
      .maybeSingle(),
    supabase.from("stores").select("contact_email").eq("id", ctx.store.id).single(),
  ]);
  if (error) throw error;

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Notificaciones</h1>
        <p className="text-sm text-fg-muted">
          Tus compradores siempre reciben la confirmación, el envío, la cancelación y los reembolsos
          de su pedido, con el nombre de tu tienda.
        </p>
      </header>
      <NotificationsForm
        storeHandle={ctx.store.handle}
        contactEmail={(store?.contact_email as string | null) ?? null}
        initial={{
          staff_emails: ((settings?.staff_emails as string[] | undefined) ?? []).join("\n"),
          notify_new_order: (settings?.notify_new_order as boolean | undefined) ?? true,
          notify_paid: (settings?.notify_paid as boolean | undefined) ?? true,
        }}
      />
      <CartRecoveryForm
        storeHandle={ctx.store.handle}
        enabled={(settings?.cart_recovery as boolean | undefined) ?? false}
      />
    </section>
  );
}
