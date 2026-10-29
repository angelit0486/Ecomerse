"use client";

import { Button } from "@/ui/primitives/button";

import type { FormState } from "../../_shared/action-state";
import { FormFeedback } from "../../_shared/form-feedback";
import { saveCartRecovery } from "./actions";
import { useSafeActionState } from "@/ui/use-safe-action-state";

/** ADR-048: un solo correo por carrito dejado, con enlace para darse de baja. */
export function CartRecoveryForm({
  storeHandle,
  enabled,
}: {
  storeHandle: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useSafeActionState<FormState, FormData>(
    saveCartRecovery.bind(null, storeHandle),
    {},
  );
  return (
    <form
      action={action}
      className="max-w-lg space-y-3 rounded-lg border border-border p-4"
      aria-labelledby="cart-recovery-title"
    >
      <h2 id="cart-recovery-title" className="text-base font-semibold">
        Recordatorio de carritos
      </h2>
      <p className="text-sm text-fg-muted">
        Si alguien escribe su correo en el pago y no termina la compra, le enviamos un solo correo 3
        horas después con un enlace para volver a su carrito. El correo incluye un enlace para no
        recibir más recordatorios y no lleva descuentos.
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="cart_recovery"
          value="1"
          defaultChecked={state.values ? state.values.cart_recovery === "1" : enabled}
        />
        Enviar el recordatorio a quien deje su carrito
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          Guardar recordatorio
        </Button>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
