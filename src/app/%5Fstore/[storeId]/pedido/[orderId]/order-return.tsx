"use client";

import { useActionState, useId } from "react";

import {
  RETURN_REASON_LABEL,
  RETURN_REASONS,
  RETURN_STATUS_FOR_CUSTOMER,
} from "@/lib/returns/labels";
import type { ReturnOptions } from "@/server/storefront/returns";

import type { ReturnActionState } from "./return-actions";

const field =
  "w-full rounded-[var(--sf-radius-input,0.375rem)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 py-2 text-sm";

type Action = (state: ReturnActionState, formData: FormData) => Promise<ReturnActionState>;

/**
 * «Devolver productos» (ADR-061): solo si la tienda ofrece devoluciones. Muestra
 * la última solicitud y, dentro del plazo, el formulario con las unidades que la
 * base dice que aún se pueden devolver.
 */
export function OrderReturn({
  options,
  action: send,
  deadlineLabel,
  windowClosed,
}: {
  options: ReturnOptions;
  action: Action;
  deadlineLabel: string | null;
  /** El plazo ya pasó (lo calcula el servidor con la fecha de la base). */
  windowClosed: boolean;
}) {
  const [state, action, pending] = useActionState<ReturnActionState, FormData>(send, {});
  const id = useId();
  const last = options.last;
  const canRequest = options.open && options.lines.length > 0;
  if (!last && !canRequest && !(deadlineLabel && windowClosed)) return null;
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="space-y-4 border-t border-[var(--sf-border)] pt-5"
    >
      <h2 id={`${id}-h`} className="font-semibold">
        Devoluciones
      </h2>
      {last && !state.ok ? (
        <div role="status" className="space-y-1 text-sm">
          <p className="font-medium">{RETURN_STATUS_FOR_CUSTOMER[last.status]}</p>
          <ul>
            {last.items.map((i, n) => (
              <li key={n}>
                {i.title}
                {i.variant ? ` (${i.variant})` : ""} × {i.quantity}
              </li>
            ))}
          </ul>
          {last.customer_message ? <p>Mensaje de la tienda: {last.customer_message}</p> : null}
        </div>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      ) : canRequest ? (
        <form action={action} aria-label="Pedir una devolución" className="space-y-3">
          <p className="text-sm text-[var(--sf-muted)]">
            ¿Algo no salió bien? Pide la devolución
            {deadlineLabel ? ` hasta el ${deadlineLabel}` : ""}. La tienda la revisará y te
            escribirá con los pasos.
          </p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Unidades a devolver</legend>
            {options.lines.map((l) => (
              <label
                key={l.order_item_id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>
                  {l.title}
                  {l.variant ? ` (${l.variant})` : ""}
                </span>
                <input
                  name={`q_${l.order_item_id}`}
                  type="number"
                  min={0}
                  max={l.available}
                  defaultValue={0}
                  aria-label={`Unidades de ${l.title}${l.variant ? ` (${l.variant})` : ""} a devolver`}
                  className={`${field} w-20`}
                />
              </label>
            ))}
            {state.fields?.items ? (
              <p className="text-sm text-[var(--sf-danger)]">{state.fields.items}</p>
            ) : null}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              Motivo
            </label>
            <select id={`${id}-reason`} name="reason" required defaultValue="" className={field}>
              <option value="" disabled>
                Elige un motivo
              </option>
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {RETURN_REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              Cuéntanos qué pasó (opcional)
            </label>
            <textarea id={`${id}-note`} name="note" maxLength={1000} rows={3} className={field} />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-[var(--sf-danger)]">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Pedir devolución"}
          </button>
        </form>
      ) : !last && deadlineLabel && windowClosed ? (
        <p className="text-sm text-[var(--sf-muted)]">
          El plazo para pedir una devolución terminó el {deadlineLabel}.
        </p>
      ) : null}
    </section>
  );
}
