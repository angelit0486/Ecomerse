import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  LIMIT_LABELS,
  MEASURED_KEYS,
} from "@/lib/billing/entitlements";
import { canManageTenants, requirePlatformRole } from "@/server/auth/platform";
import { callRpc } from "@/server/db/rpc";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { formatMoney } from "@/lib/money/format";

import { PlanForm, PlanPricingForm, type PlanValues } from "../billing-forms";

export const metadata = { title: "Planes" };

interface PlanRow extends PlanValues {
  subscribers: number;
  price_monthly: number | null;
  price_annual: number | null;
  currency: string;
  trial_days: number | null;
}

/** «$499.00 al mes · $4,790.00 al año · 14 días de prueba» o «Sin precio». */
function priceLine(plan: PlanRow): string {
  const parts = [
    plan.price_monthly !== null ? `${formatMoney(plan.price_monthly, plan.currency)} al mes` : null,
    plan.price_annual !== null ? `${formatMoney(plan.price_annual, plan.currency)} al año` : null,
    plan.trial_days ? `${plan.trial_days} días de prueba` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Sin precio";
}

const STATUS: Record<string, string> = {
  active: "Activo",
  legacy: "Anterior",
  hidden: "Oculto",
};

/**
 * Planes que se venden a los comercios (F10, GATE0 §19). Cada plan fija los
 * límites que la base aplica al crear tiendas, productos, equipo y fotos.
 */
export default async function PlansPage() {
  const role = await requirePlatformRole();
  const supabase = await createSupabaseServerClient();
  const plans = await callRpc<PlanRow[]>(supabase, "platform_list_plans", {});
  const manage = canManageTenants(role);

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Planes</h1>
        <p className="text-sm text-fg-muted">
          Lo que incluye cada plan. Bajar un límite no borra nada: solo impide crear más.
        </p>
      </header>

      {plans.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm">
          Aún no hay planes. Crea el primero abajo para poder dar de alta comercios.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <li key={plan.key} className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{plan.name}</h2>
                <span className="text-[13px] text-fg-muted">
                  {STATUS[plan.status] ?? plan.status} · {plan.subscribers}{" "}
                  {plan.subscribers === 1 ? "comercio" : "comercios"}
                </span>
              </div>
              <p className="text-sm font-medium">{priceLine(plan)}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {MEASURED_KEYS.map((key) => (
                  <div key={key} className="contents">
                    <dt className="text-fg-muted">{LIMIT_LABELS[key]}</dt>
                    <dd className="text-right tabular-nums">
                      {String(plan.entitlements[key] ?? 0)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-[13px] text-fg-muted">
                {FEATURE_KEYS.filter((k) => plan.entitlements[k] === true)
                  .map((k) => FEATURE_LABELS[k])
                  .join(", ") || "Sin funciones extra"}
              </p>
              {manage ? (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline sm:min-h-9">
                    Editar {plan.name}
                  </summary>
                  <div className="pt-4">
                    <PlanForm plan={plan} />
                  </div>
                </details>
              ) : null}
              {manage ? (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline sm:min-h-9">
                    Precios de {plan.name}
                  </summary>
                  <div className="pt-4">
                    <PlanPricingForm plan={plan} />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {manage ? (
        <section aria-labelledby="nuevo-plan" className="space-y-4">
          <h2 id="nuevo-plan" className="font-semibold">
            Nuevo plan
          </h2>
          <PlanForm />
        </section>
      ) : null}
    </section>
  );
}
