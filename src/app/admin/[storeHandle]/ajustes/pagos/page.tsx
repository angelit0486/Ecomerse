import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hasPermission } from "@/server/auth/context";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { callRpc } from "@/server/db/rpc";
import { stripeProvider } from "@/server/payments/registry";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { ManualPaymentForm } from "../../configuracion/launch-forms";
import type { StripeSettings } from "./actions";
import { ConnectStripeButton, StripeToggle } from "./stripe-forms";

export const metadata: Metadata = { title: "Pagos" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<{ stripe?: string }>;
};

/** Avisos del retorno de Stripe (texto fijo: el parámetro nunca se muestra tal cual). */
const RETURN_NOTICES: Record<string, { tone: "success" | "warning"; text: string }> = {
  activo: { tone: "success", text: "Stripe confirmó tu cuenta: ya puedes cobrar con tarjeta." },
  pendiente: {
    tone: "warning",
    text: "Stripe aún revisa tu cuenta. Te avisaremos aquí cuando puedas cobrar con tarjeta.",
  },
  error: { tone: "warning", text: "No pudimos consultar a Stripe. Vuelve a intentarlo más tarde." },
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activa: tus compradores pueden pagar con tarjeta.",
  pending: "Pendiente: completa el registro en Stripe para empezar a cobrar.",
  disabled: "Desactivada por la tienda.",
  error: "Con problemas: revisa tu cuenta en Stripe.",
};

export default async function PaymentsSettingsPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!hasPermission(ctx, "payments.manage")) notFound();
  const notice = RETURN_NOTICES[(await searchParams).stripe ?? ""];
  const supabase = await createSupabaseServerClient();
  const [settings, { data: manual, error }] = await Promise.all([
    callRpc<StripeSettings>(supabase, "payments_get_stripe", { p_store_id: ctx.store.id }),
    supabase
      .from("payment_accounts")
      .select("display_name, status, public_config")
      .eq("store_id", ctx.store.id)
      .eq("provider", "manual")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw error;
  const stripeAvailable = stripeProvider() !== null;
  const account = settings.account;

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Pagos</h1>
        <p className="text-sm text-fg-muted">
          El dinero de cada venta llega directo a tu cuenta: la plataforma nunca lo retiene.
        </p>
      </header>

      {notice ? (
        <p
          role="status"
          className={`rounded-md border p-3 text-sm ${notice.tone === "success" ? "border-success text-success" : "border-warning"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <section
        aria-labelledby="pago-tarjeta"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="pago-tarjeta" className="text-base font-semibold">
          Tarjeta de crédito o débito (Stripe)
        </h2>
        {!stripeAvailable ? (
          <p className="text-sm text-fg-muted">
            El cobro con tarjeta aún no está disponible en esta plataforma.
          </p>
        ) : account ? (
          <>
            <p className="text-sm">
              {STATUS_LABELS[account.status] ?? account.status}
              {account.mode === "test" ? " (modo de prueba: no se cobra dinero real)" : ""}
            </p>
            {account.status === "pending" ? (
              <ConnectStripeButton
                storeHandle={ctx.store.handle}
                label="Continuar el registro en Stripe"
              />
            ) : null}
            {account.status !== "error" ? (
              <StripeToggle
                storeHandle={ctx.store.handle}
                enabled={account.status !== "disabled"}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              Crea o conecta tu cuenta de Stripe. Stripe te pedirá los datos de tu negocio y de la
              cuenta bancaria donde recibirás el dinero.
            </p>
            <ConnectStripeButton storeHandle={ctx.store.handle} label="Conectar con Stripe" />
          </>
        )}
      </section>

      <section
        aria-labelledby="pago-transferencia"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="pago-transferencia" className="text-base font-semibold">
          Transferencia o depósito
        </h2>
        <p className="text-sm text-fg-muted">
          Tú confirmas cada pago desde Pedidos cuando veas el dinero en tu cuenta.
        </p>
        <ManualPaymentForm
          storeHandle={ctx.store.handle}
          initial={{
            display_name: (manual?.display_name as string | undefined) ?? "Transferencia bancaria",
            instructions:
              (manual?.public_config as { instructions?: string } | undefined)?.instructions ?? "",
            active: manual ? manual.status === "active" : true,
          }}
        />
      </section>
    </section>
  );
}
