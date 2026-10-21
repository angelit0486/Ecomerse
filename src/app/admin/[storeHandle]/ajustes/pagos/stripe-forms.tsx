"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { connectStripe, setStripeEnabled } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ConnectStripeButton({
  storeHandle,
  label,
}: {
  storeHandle: string;
  label: string;
}) {
  const [state, action, pending] = useSafeActionState<FormState>(
    connectStripe.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={pending}>
        {label}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function StripeToggle({ storeHandle, enabled }: { storeHandle: string; enabled: boolean }) {
  const [state, action, pending] = useSafeActionState<FormState>(
    setStripeEnabled.bind(null, storeHandle, !enabled),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {enabled ? (
        <ConfirmButton
          size="sm"
          loading={pending}
          question="¿Desactivar el cobro con tarjeta?"
          detail="La tienda deja de aceptar pagos con tarjeta hasta que lo reactives."
        >
          Desactivar cobro con tarjeta
        </ConfirmButton>
      ) : (
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Reactivar cobro con tarjeta
        </Button>
      )}
      <FormFeedback state={state} />
    </form>
  );
}
