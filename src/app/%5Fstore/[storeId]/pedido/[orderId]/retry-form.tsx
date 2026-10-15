"use client";

import { useActionState } from "react";

import { retry, type CartActionState } from "../../carrito/actions";

export function RetryPayment({
  storeId,
  orderId,
  token,
}: {
  storeId: string;
  orderId: string;
  token: string;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    async () => retry(storeId, orderId, token),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:opacity-60"
      >
        {pending ? "Redirigiendo…" : "Reintentar el pago"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
