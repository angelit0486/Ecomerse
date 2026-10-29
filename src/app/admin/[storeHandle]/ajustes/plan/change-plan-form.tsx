"use client";

import { formatMoney } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import { changeCardPlan } from "./billing-actions";
import type { PayablePlan } from "./card-payment-form";

/** Cambiar plan o periodo de la suscripción con tarjeta (ADR-044, con prorrateo). */
export function ChangePlanForm({
  storeHandle,
  plans,
  current,
}: {
  storeHandle: string;
  plans: PayablePlan[];
  current: { plan_key: string | null; interval: string };
}) {
  const [state, action, pending] = useSafeActionState(changeCardPlan.bind(null, storeHandle), {});
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Plan y periodo nuevos</legend>
        {plans.flatMap((p) =>
          (
            [
              ["monthly", p.price_monthly, "al mes"],
              ["annual", p.price_annual, "al año"],
            ] as const
          )
            .filter(([, price]) => price !== null && price > 0)
            .map(([interval, price, label]) => {
              const isCurrent = p.key === current.plan_key && interval === current.interval;
              return (
                <label
                  key={`${p.key}-${interval}`}
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm"
                >
                  <input
                    type="radio"
                    name="choice"
                    value={`${p.key}:${interval}`}
                    disabled={isCurrent}
                    required
                  />
                  <span>
                    <span className="font-medium">{p.name}</span> ·{" "}
                    {formatMoney(price!, p.currency)} {label}
                    {isCurrent ? " (tu plan actual)" : ""}
                  </span>
                </label>
              );
            }),
        )}
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.message ? (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Cambiando…" : "Cambiar plan"}
      </Button>
      <p className="text-[13px] text-fg-muted">
        Stripe prorratea: te abona lo que no usaste del plan actual y cobra la diferencia a tu
        tarjeta. Si cambias de mensual a anual, el nuevo periodo empieza hoy.
      </p>
    </form>
  );
}
