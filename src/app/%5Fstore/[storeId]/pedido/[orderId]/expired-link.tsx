"use client";

import { useActionState } from "react";

import { requestNewLink, type LinkActionState } from "./link-actions";

/**
 * El enlace del pedido venció o ya se reemplazó (ADR-062): se pide uno nuevo,
 * que llega al correo del pedido. Nada del pedido se muestra aquí.
 */
export function ExpiredLink({
  storeId,
  orderId,
  token,
  state,
}: {
  storeId: string;
  orderId: string;
  token: string;
  state: "expired" | "replaced";
}) {
  const [result, action, pending] = useActionState<LinkActionState, FormData>(
    async () => requestNewLink(storeId, orderId, token),
    {},
  );
  return (
    <section className="mx-auto max-w-xl space-y-4 py-8">
      <h1 className="text-2xl font-bold">
        {state === "expired" ? "Este enlace venció" : "Este enlace ya no funciona"}
      </h1>
      <p>
        {state === "expired"
          ? "Por seguridad, el enlace de tu pedido deja de funcionar 180 días después de su último movimiento. Te mandamos uno nuevo al correo con el que hiciste el pedido."
          : "Ya se pidió un enlace nuevo para este pedido y este dejó de funcionar. Revisa tu correo; si no te llegó, pide otro."}
      </p>
      {result.ok ? (
        <p role="status" className="rounded-[var(--sf-radius-card)] bg-[var(--sf-surface)] p-3">
          {result.message}
        </p>
      ) : (
        <form action={action} className="space-y-2">
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Mandarme un enlace nuevo"}
          </button>
          {result.error ? (
            <p role="alert" className="text-sm text-[var(--sf-danger)]">
              {result.error}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
