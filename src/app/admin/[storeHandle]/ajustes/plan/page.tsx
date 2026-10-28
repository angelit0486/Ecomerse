import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ACCESS_MODE, keyDate, SUBSCRIPTION_STATUS } from "@/lib/billing/entitlements";
import { getStoreContextForPage } from "@/server/auth/store-context-page";
import { canSeePlan, loadPlanUsage } from "@/server/billing/plan-usage";
import { PlanUsage } from "@/ui/billing/plan-usage";

export const metadata: Metadata = { title: "Plan y uso" };

type Props = { params: Promise<{ storeHandle: string }> };

const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long" });

/**
 * Plan y uso (F10-T02): qué incluye el plan de la organización y cuánto se usa
 * de cada límite, medido en vivo. Solo la dueña o la administración de la
 * organización (org.billing.read).
 */
export default async function PlanPage({ params }: Props) {
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

      <section aria-labelledby="uso" className="space-y-3">
        <h2 id="uso" className="font-semibold">
          Uso
        </h2>
        <PlanUsage entitlements={billing.entitlements} />
      </section>
    </section>
  );
}
