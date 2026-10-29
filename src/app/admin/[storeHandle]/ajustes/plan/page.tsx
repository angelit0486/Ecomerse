import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ACCESS_MODE, keyDate, SUBSCRIPTION_STATUS } from "@/lib/billing/entitlements";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { canSeePlan, loadPlanUsage } from "@/server/billing/plan-usage";
import { stripeBilling } from "@/server/billing/stripe-billing";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { PlanUsage } from "@/ui/billing/plan-usage";

import { CardPaymentForm, type PayablePlan } from "./card-payment-form";

export const metadata: Metadata = { title: "Plan y uso" };

type Props = {
  params: Promise<{ storeHandle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long" });

/**
 * Plan y uso (F10-T02): qué incluye el plan de la organización y cuánto se usa
 * de cada límite, medido en vivo. Solo la dueña o la administración de la
 * organización (org.billing.read).
 */
export default async function PlanPage({ params, searchParams }: Props) {
  const { storeHandle } = await params;
  const ctx = await getStoreContextForPage(storeHandle);
  if (!canSeePlan(ctx)) notFound();
  const billing = await loadPlanUsage(ctx.store.id);

  if (!billing) {
    return (
      <section className="max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold">Plan y uso</h1>
        <p className="rounded-md border border-border p-4 text-sm">
          Esta sección estará disponible en cuanto la plataforma termine su actualización.
        </p>
      </section>
    );
  }

  const sub = billing.subscription;
  const due = keyDate(sub);
  const sp = await searchParams;
  // Pagar con tarjeta (ADR-044): solo la dueña de la organización y con Stripe
  // configurado. La base no ofrece planes si ya hay una suscripción de Stripe vigente.
  const payWithCard =
    ctx.orgRole === "org_owner" && stripeBilling() !== null
      ? await callRpc<PayablePlan[]>(await createSupabaseServerClient(), "org_billing_plans", {
          p_store_id: ctx.store.id,
        }).catch(() => [])
      : [];
  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Plan y uso</h1>
        <p className="text-sm text-fg-muted">
          Lo que incluye tu plan y cuánto usas. Si te acercas a un límite, pide un cambio de plan a
          la plataforma.
        </p>
      </header>

      <dl className="grid gap-x-6 gap-y-3 rounded-md border border-border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Plan</dt>
          <dd className="font-semibold">{billing.plan?.name ?? "Sin plan"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Estado</dt>
          <dd>{sub ? (SUBSCRIPTION_STATUS[sub.status] ?? sub.status) : "Sin suscripción"}</dd>
        </div>
        {due ? (
          <div>
            <dt className="text-fg-muted">{due.label}</dt>
            <dd>{date.format(new Date(due.at))}</dd>
          </div>
        ) : null}
        {billing.access_mode !== "full" ? (
          <div>
            <dt className="text-fg-muted">Acceso</dt>
            <dd className="text-danger">{ACCESS_MODE[billing.access_mode]}</dd>
          </div>
        ) : null}
      </dl>

      {sp.pago === "listo" ? (
        <p role="status" className="rounded-md border border-success p-3 text-sm">
          Recibimos tu pago en Stripe. Tu plan se actualiza en cuanto Stripe lo confirma (suele
          tardar unos segundos).
        </p>
      ) : null}
      {payWithCard.length > 0 ? (
        <section aria-labelledby="pagar" className="space-y-3 rounded-md border border-border p-4">
          <h2 id="pagar" className="font-semibold">
            Pagar con tarjeta
          </h2>
          <CardPaymentForm
            storeHandle={ctx.store.handle}
            plans={payWithCard}
            currentPlan={billing.plan?.key ?? null}
          />
        </section>
      ) : null}

      <section aria-labelledby="uso" className="space-y-3">
        <h2 id="uso" className="font-semibold">
          Uso
        </h2>
        <PlanUsage entitlements={billing.entitlements} />
      </section>
    </section>
  );
}
