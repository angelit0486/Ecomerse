"use client";

import { useActionState } from "react";

import { applyDiscount, updateLine, type CartActionState } from "./actions";

const control =
  "h-10 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3 text-sm";
const secondary =
  "h-10 rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-4 text-sm font-medium disabled:opacity-60";

function Message({ state }: { state: CartActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[var(--sf-danger,#b91c1c)]">
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
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="variant_id" value={variantId} />
      <label className="flex flex-col gap-1 text-sm">
        Cantidad de {title}
        <input
          type="number"
          name="quantity"
          min={1}
          max={999}
          defaultValue={quantity}
          inputMode="numeric"
          className={`${control} w-20`}
        />
      </label>
      <button type="submit" disabled={pending} className={secondary}>
        Actualizar
      </button>
      <button
        type="submit"
        name="remove"
        value="1"
        disabled={pending}
        className="h-10 px-2 text-sm underline disabled:opacity-60"
        aria-label={`Quitar ${title}`}
      >
        Quitar
      </button>
      <div className="basis-full">
        <Message state={state} />
      </div>
    </form>
  );
}

export function DiscountForm({ storeId, code }: { storeId: string; code: string | null }) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    applyDiscount.bind(null, storeId),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          Código de descuento
          <input
            name="discount_code"
            defaultValue={code ?? ""}
            maxLength={32}
            autoCapitalize="characters"
            aria-invalid={state.fields?.discount_code ? true : undefined}
            className={control}
          />
        </label>
        <button type="submit" disabled={pending} className={secondary}>
          Aplicar
        </button>
        {code ? (
          <button
            type="submit"
            name="remove"
            value="1"
            disabled={pending}
            className="h-10 px-2 text-sm underline"
          >
            Quitar código
          </button>
        ) : null}
      </div>
      <Message state={state} />
    </form>
  );
}
