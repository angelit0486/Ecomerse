"use client";

import { useActionState, useId } from "react";

import type { ReviewActionState } from "./review-actions";

const field =
  "w-full rounded-[var(--sf-radius-input,0.375rem)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 py-2 text-sm";

/**
 * Formulario de opinión de un producto del pedido (ADR-029). La acción llega ya
 * ligada al pedido y producto: desde el enlace del pedido o desde «Mi cuenta».
 */
export function ReviewForm({
  action: send,
  title,
}: {
  action: (state: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
  title: string;
}) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(send, {});
  const id = useId();
  if (state.ok) {
    return (
      <p role="status" className="text-sm">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3" aria-label={`Tu opinión sobre ${title}`}>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Calificación</legend>
        <div className="sf-stars flex flex-row-reverse justify-end gap-1">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={n}
                required
                className="peer sr-only"
                aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}
              />
              <span
                aria-hidden
                className="block text-2xl leading-none text-[var(--sf-border-strong)] peer-checked:text-[var(--sf-fg)] peer-focus-visible:outline peer-focus-visible:outline-2"
              >
                ★
              </span>
            </label>
          ))}
        </div>
        {state.fields?.rating ? (
          <p className="text-sm text-[var(--sf-danger,#b91c1c)]">{state.fields.rating}</p>
        ) : null}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Título (opcional)
        </label>
        <input id={`${id}-title`} name="title" maxLength={120} className={field} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-body`} className="text-sm font-medium">
          Tu opinión
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          className={field}
          aria-invalid={state.fields?.body ? true : undefined}
        />
        <p className="text-xs text-[var(--sf-muted)]">
          Cuenta cómo te fue con el producto. Por ley no podemos publicar opiniones que digan que un
          suplemento cura o previene enfermedades.
        </p>
      </div>
      {state.error && !state.fields?.rating ? (
        <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:opacity-60"
      >
        {pending ? "Enviando…" : "Enviar opinión"}
      </button>
    </form>
  );
}
