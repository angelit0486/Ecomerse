"use client";

import { useActionState, useRef, useSyncExternalStore } from "react";

import { applyDiscount, updateLine, type CartActionState } from "./actions";

const control =
  "h-10 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 text-sm";
const secondary =
  "h-10 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium disabled:opacity-60";

const noSubscribe = () => () => {};

function Message({ state }: { state: CartActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[var(--sf-danger)]">
        {state.error}
      </p>
    );
  }
  return state.ok ? (
    <p role="status" className="text-sm">
      {state.message}
    </p>
  ) : null;
}

/**
 * Cantidad de un renglón (revisión de conversión, M10): con JavaScript, −/+ de
 * 44 px y el campo se envían solos; sin él, el campo y «Actualizar».
 */
export function LineForm({
  storeId,
  variantId,
  title,
  quantity,
}: {
  storeId: string;
  variantId: string;
  title: string;
  quantity: number;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    updateLine.bind(null, storeId),
    {},
  );
  const hydrated = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const input = useRef<HTMLInputElement>(null);
  function submitIfChanged() {
    const el = input.current;
    if (el && el.value !== String(quantity) && el.checkValidity()) el.form?.requestSubmit();
  }
  function step(delta: number) {
    const el = input.current;
    if (!el) return;
    el.value = String(Math.min(999, Math.max(1, quantity + delta)));
    submitIfChanged();
  }
  const stepper = "h-11 w-11 text-lg font-semibold disabled:opacity-40";
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="variant_id" value={variantId} />
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`qty-${variantId}`}>
          Cantidad<span className="sr-only"> de {title}</span>
        </label>
        <div className="inline-flex w-fit items-stretch rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)]">
          {hydrated ? (
            <button
              type="button"
              aria-label={`Restar 1 a ${title}`}
              disabled={pending || quantity <= 1}
              onClick={() => step(-1)}
              className={stepper}
            >
              <span aria-hidden="true">−</span>
            </button>
          ) : null}
          <input
            ref={input}
            id={`qty-${variantId}`}
            type="number"
            name="quantity"
            min={1}
            max={999}
            defaultValue={quantity}
            key={quantity}
            inputMode="numeric"
            // Mientras se guarda, lo escrito se perdería al llegar la cantidad nueva.
            readOnly={pending}
            onBlur={submitIfChanged}
            className={`sf-qty h-11 w-14 bg-[var(--sf-bg)] text-center ${hydrated ? "border-x border-[var(--sf-border)]" : ""}`}
          />
          {hydrated ? (
            <button
              type="button"
              aria-label={`Sumar 1 a ${title}`}
              disabled={pending || quantity >= 999}
              onClick={() => step(1)}
              className={stepper}
            >
              <span aria-hidden="true">+</span>
            </button>
          ) : null}
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`${secondary} ${hydrated ? "hidden" : ""}`}
      >
        Actualizar
      </button>
      <button
        type="submit"
        name="remove"
        value="1"
        disabled={pending}
        className="h-11 px-0 text-sm underline underline-offset-4 disabled:opacity-60"
        aria-label={`Quitar ${title}`}
      >
        Quitar
      </button>
      <div className="basis-full" aria-live="polite">
        <Message state={state} />
      </div>
    </form>
  );
}

/** Código de descuento plegado tras «¿Tienes un código?» (revisión de conversión, M10). */
export function DiscountForm({ storeId, code }: { storeId: string; code: string | null }) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    applyDiscount.bind(null, storeId),
    {},
  );
  return (
    <details open={Boolean(code || state.error)} className="group text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium underline underline-offset-4">
        {code ? `Código aplicado: ${code}` : "¿Tienes un código de descuento?"}
      </summary>
      <form action={action} className="space-y-2 pt-2">
        <div className="flex items-end gap-2">
          {/* min-w-0: a 375 px el botón no se sale de la tarjeta (M10). */}
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
            Código de descuento
            <input
              name="discount_code"
              defaultValue={code ?? ""}
              maxLength={32}
              autoCapitalize="characters"
              aria-invalid={state.fields?.discount_code ? true : undefined}
              className={`${control} w-full min-w-0`}
            />
          </label>
          <button type="submit" disabled={pending} className={`${secondary} shrink-0`}>
            Aplicar
          </button>
        </div>
        {code ? (
          <button
            type="submit"
            name="remove"
            value="1"
            disabled={pending}
            className="h-10 text-sm underline"
          >
            Quitar código
          </button>
        ) : null}
        <Message state={state} />
      </form>
    </details>
  );
}
