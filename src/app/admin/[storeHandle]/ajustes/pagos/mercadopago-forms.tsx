"use client";

import { Button } from "@/ui/primitives/button";
import { ConfirmButton } from "@/ui/primitives/confirm-button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import {
  connectMercadoPago,
  setMercadoPagoEnabled,
  startMercadoPagoOAuth,
} from "./mercadopago-actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

export function ConnectMercadoPagoButton({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useSafeActionState<FormState>(
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

/** ADR-041: lleva a Mercado Pago para autorizar la cuenta del comercio. */
export function ConnectOwnMercadoPagoButton({ storeHandle }: { storeHandle: string }) {
  const [state, action, pending] = useSafeActionState<FormState>(
    startMercadoPagoOAuth.bind(null, storeHandle),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" loading={pending}>
        Conectar mi cuenta de Mercado Pago
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
  const [state, action, pending] = useSafeActionState<FormState>(
    setMercadoPagoEnabled.bind(null, storeHandle, !enabled),
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {enabled ? (
        <ConfirmButton
          size="sm"
          loading={pending}
          question="¿Desactivar Mercado Pago?"
          detail="La tienda deja de aceptar pagos con Mercado Pago hasta que lo reactives."
        >
          Desactivar Mercado Pago
        </ConfirmButton>
      ) : (
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Reactivar Mercado Pago
        </Button>
      )}
      <FormFeedback state={state} />
    </form>
  );
}
