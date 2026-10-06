"use client";

import { useActionState } from "react";

import { simulatePayment, type CartActionState } from "../../carrito/actions";

export function SimulateForm(props: {
  storeId: string;
  paymentId: string;
  returnPath: string;
  signature: string;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    async (_: CartActionState, fd: FormData) =>
      simulatePayment(
        props.storeId,
        props.paymentId,
        props.returnPath,
        props.signature,
        fd.get("outcome") === "succeeded" ? "succeeded" : "failed",
      ),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-3">
        <button
          type="submit"
          name="outcome"
          value="succeeded"
          disabled={pending}
          className="h-11 flex-1 rounded-[var(--sf-radius-btn)] bg-[var(--sf-primary)] font-medium text-[var(--sf-on-primary)]"
        >
          Aprobar pago
        </button>
        <button
          type="submit"
          name="outcome"
          value="failed"
          disabled={pending}
          className="h-11 flex-1 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] font-medium"
        >
          Rechazar pago
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
