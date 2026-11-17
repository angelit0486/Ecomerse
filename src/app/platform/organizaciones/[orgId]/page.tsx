import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  ACCESS_MODE,
  billingSchema,
  keyDate,
  SUBSCRIPTION_STATUS,
} from "@/lib/billing/entitlements";
import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { AppError } from "@/server/errors";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { PlanUsage } from "@/ui/billing/plan-usage";

import { OverrideForm, SetupFeeForm, SubscriptionForm } from "../../billing-forms";

export const metadata = { title: "Organización" };

const orgBilling = billingSchema.extend({
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    billing_email: z.string().nullable(),
  }),
});

const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

const setupFeeSchema = z.object({
  settled_at: z.string().nullable(),
  paid_by_card: z.boolean(),
  due: z.boolean(),
});

/** «Pagada con tarjeta», «Saldada el …» o «Pendiente: se cobra en el primer pago con tarjeta». */
function setupFeeLine(fee: z.infer<typeof setupFeeSchema>): string {
  if (fee.settled_at)
    return `Saldada por la plataforma el ${date.format(new Date(fee.settled_at))}`;
  if (fee.paid_by_card) return "Incluida en su primer pago con tarjeta";
  return "Pendiente: se cobra en su primer pago con tarjeta";
}

/**
 * Plan, suscripción y límites de una organización (F10-T02). El cobro es manual
 * (§19.5): aquí se registra cada pago, la prueba, el pago pendiente o la pausa.
 */
export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const role = await requirePlatformRole();
  const { orgId } = await params;
  if (!z.uuid().safeParse(orgId).success) notFound();
  const supabase = await createSupabaseServerClient();
  let billing: z.infer<typeof orgBilling>;
  try {
    billing = orgBilling.parse(
      await callRpc(supabase, "platform_get_org_billing", { p_organization_id: orgId }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  }
  const plans = await callRpc<{ key: string; name: string; status: string }[]>(
    supabase,
    "platform_list_plans",
    {},
  );
  const setupFee = setupFeeSchema.parse(
    await callRpc(supabase, "platform_org_setup_fee", { p_organization_id: orgId }),
  );
  const manage = canManageTenants(role);
  const sub = billing.subscription;
  const due = keyDate(sub);

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <Link
          href="/platform"
          className="inline-flex min-h-11 items-center text-sm underline sm:min-h-9"
        >
          ← Organizaciones
        </Link>
        <h1 className="text-xl font-semibold">{billing.organization.name}</h1>
        <p className="text-sm text-fg-muted">
          {billing.organization.slug}
          {billing.organization.billing_email
            ? ` · Facturación: ${billing.organization.billing_email}`
            : ""}
        </p>
      </header>

      <section
        aria-labelledby="suscripcion"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="suscripcion" className="font-semibold">
          Suscripción
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Plan</dt>
            <dd>{billing.plan?.name ?? "Sin suscripción vigente"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Estado</dt>
            <dd>{sub ? (SUBSCRIPTION_STATUS[sub.status] ?? sub.status) : "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Acceso del comercio</dt>
            <dd>{ACCESS_MODE[billing.access_mode]}</dd>
          </div>
          {due ? (
            <div>
              <dt className="text-fg-muted">{due.label}</dt>
              <dd>{date.format(new Date(due.at))}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-fg-muted">Cuota de arranque</dt>
            <dd>{setupFeeLine(setupFee)}</dd>
          </div>
        </dl>
        {sub?.notes ? <p className="text-[13px] text-fg-muted">Notas: {sub.notes}</p> : null}
      </section>

      {manage ? (
        <section aria-labelledby="cobro" className="space-y-3">
          <h2 id="cobro" className="font-semibold">
            Registrar un cambio
          </h2>
          <p className="text-sm text-fg-muted">
            Al vencer el periodo pagado, la cuenta pasa sola a pago pendiente con 7 días de gracia;
            después queda en solo lectura y, a los 30 días, sin acceso. Las tiendas siguen vendiendo
            mientras tanto.
          </p>
          <SubscriptionForm
            organizationId={billing.organization_id}
            plans={plans
              .filter((p) => p.status !== "hidden")
              .map((p) => ({ value: p.key, label: p.name }))}
            currentPlan={billing.plan?.key ?? null}
          />
        </section>
      ) : null}

      {manage && !setupFee.paid_by_card ? (
        <section aria-labelledby="arranque" className="space-y-3">
          <h2 id="arranque" className="font-semibold">
            Cuota de arranque
          </h2>
          <p className="text-sm text-fg-muted">
            Se cobra una sola vez, con el primer pago con tarjeta. Si la cobraste por transferencia
            o la condonas, márcala aquí para que no se cobre otra vez.
          </p>
          <SetupFeeForm organizationId={billing.organization_id} due={setupFee.due} />
        </section>
      ) : null}

      <section aria-labelledby="uso" className="space-y-3">
        <h2 id="uso" className="font-semibold">
          Límites y uso
        </h2>
        <PlanUsage entitlements={billing.entitlements} showAll />
      </section>

      {manage ? (
        <section aria-labelledby="excepciones" className="space-y-3">
          <h2 id="excepciones" className="font-semibold">
            Excepciones
          </h2>
          <p className="text-sm text-fg-muted">
            Cambia un límite solo para esta organización (por ejemplo, una promoción). Manda sobre
            el plan mientras esté vigente.
          </p>
          <OverrideForm organizationId={billing.organization_id} />
        </section>
      ) : null}
    </section>
  );
}
