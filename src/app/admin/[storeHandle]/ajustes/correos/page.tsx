import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EDITABLE_EMAILS } from "@/lib/emails/store-texts";
import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { panelFlagEnabled } from "../../_shared/panel-flags";
import { EmailTextForm } from "./forms";

export const metadata: Metadata = { title: "Correos" };

type Props = { params: Promise<{ storeHandle: string }> };

/**
 * Correos del comprador con el texto de la tienda (auditoría global, paso 20;
 * interruptor email_texts). Solo asunto y un mensaje: lo esencial no se edita.
 */
export default async function EmailTextsPage({ params }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "store.read")) notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await panelFlagEnabled(supabase, ctx.store.id, "email_texts"))) notFound();
  const { data, error } = await supabase
    .from("store_email_texts")
    .select("template, subject, note")
    .eq("store_id", ctx.store.id);
  if (error) throw error;
  const saved = new Map((data ?? []).map((r) => [r.template as string, r]));
  const canEdit = hasPermission(ctx, "store.update");

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Correos</h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Cambia el asunto y agrega un mensaje tuyo a los correos que reciben tus clientes. Los
          datos del pedido (productos, montos, guía y enlaces) siempre van. Puedes usar{" "}
          <code>{"{nombre}"}</code>, <code>{"{pedido}"}</code> y <code>{"{tienda}"}</code>. Deja los
          dos campos vacíos para volver al texto de siempre.
        </p>
      </header>
      <div className="max-w-2xl space-y-4">
        {EDITABLE_EMAILS.map((e) => {
          const row = saved.get(e.key);
          return (
            <EmailTextForm
              key={e.key}
              storeHandle={ctx.store.handle}
              storeName={ctx.store.name}
              template={e.key}
              label={e.label}
              defaultSubject={e.defaultSubject}
              subject={(row?.subject as string | null) ?? ""}
              note={(row?.note as string | null) ?? ""}
              canEdit={canEdit}
            />
          );
        })}
      </div>
    </section>
  );
}
