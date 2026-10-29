"use client";

import { formatMoney } from "@/lib/money/format";
import { Button } from "@/ui/primitives/button";
import { useSafeActionState } from "@/ui/use-safe-action-state";

import { startCardPayment } from "./billing-actions";

export interface PayablePlan {
  key: string;
  name: string;
  currency: string;
  price_monthly: number | null;
  price_annual: number | null;
}

/** Elegir plan y periodo y pagar en Stripe (ADR-044). El precio mostrado es el de la base. */
export function CardPaymentForm({
  storeHandle,
  plans,
  currentPlan,
}: {
  storeHandle: string;
  plans: PayablePlan[];
  currentPlan: string | null;
}) {
  const [state, action, pending] = useSafeActionState(startCardPayment.bind(null, storeHandle), {});
  const firstKey = plans.find((p) => p.key === currentPlan)?.key ?? plans[0]?.key;
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Plan y periodo</legend>
        {plans.flatMap((p) =>
          (
            [
              ["monthly", p.price_monthly, "al mes"],
              ["annual", p.price_annual, "al año"],
            ] as const
          )
            .filter(([, price]) => price !== null && price > 0)
            .map(([interval, price, label]) => (
              <label
                key={`${p.key}-${interval}`}
                className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm"
              >
                <input
                  type="radio"
                  name="choice"
                  value={`${p.key}:${interval}`}
                  defaultChecked={p.key === firstKey && interval === "monthly"}
                  required
                />
                <span>
                  <span className="font-medium">{p.name}</span> · {formatMoney(price!, p.currency)}{" "}
                  {label}
                </span>
              </label>
            )),
        )}
      </fieldset>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Abriendo el pago…" : "Pagar con tarjeta"}
      </Button>
      <p className="text-[13px] text-fg-muted">
        El pago se hace en Stripe; PRUVA no ve ni guarda los datos de tu tarjeta. Tu plan se activa
        en cuanto Stripe confirma el cobro.
      </p>
    </form>
  );
}
