"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { connectStripe, setStripeEnabled } from "./actions";

export function ConnectStripeButton({
  storeHandle,
  label,
}: {
  storeHandle: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<FormState>(
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
  const [state, action, pending] = useActionState<FormState>(
    setStripeEnabled.bind(null, storeHandle, !enabled),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {enabled ? "Desactivar cobro con tarjeta" : "Reactivar cobro con tarjeta"}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
