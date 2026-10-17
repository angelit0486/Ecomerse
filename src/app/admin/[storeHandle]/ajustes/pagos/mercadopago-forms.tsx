"use client";

import { useActionState } from "react";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { connectMercadoPago, setMercadoPagoEnabled } from "./mercadopago-actions";

export function ConnectMercadoPagoButton({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useActionState<FormState>(
    connectMercadoPago.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={pending}>
        Conectar Mercado Pago
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function MercadoPagoToggle({
  storeHandle,
  enabled,
}: {
  storeHandle: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState<FormState>(
    setMercadoPagoEnabled.bind(null, storeHandle, !enabled),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        {enabled ? "Desactivar Mercado Pago" : "Reactivar Mercado Pago"}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
