"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addItem, type CartActionState } from "../carrito/actions";

/** Agregar al carrito: solo variante y cantidad; el precio lo pone la base (§17.2). */
export function AddToCart({
  storeId,
  variantId,
  available,
}: {
  storeId: string;
  variantId: string | null;
  available: boolean;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    addItem.bind(null, storeId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="variant_id" value={variantId ?? ""} />
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Cantidad
          <input
            type="number"
            name="quantity"
            min={1}
            max={999}
            defaultValue={1}
            inputMode="numeric"
            className="h-11 w-20 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3"
          />
        </label>
        <button
          type="submit"
          disabled={!variantId || !available || pending}
          aria-busy={pending || undefined}
          className="h-11 flex-1 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-medium text-[var(--sf-btn-fg)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {available ? (pending ? "Agregando…" : "Agregar al carrito") : "Agotado"}
        </button>
      </div>
      <div aria-live="polite" className="text-sm">
        {state.ok ? (
          <p role="status">
            {state.message}{" "}
            <Link href="/carrito" className="font-medium underline">
              Ver carrito ({state.count})
            </Link>
          </p>
        ) : state.error ? (
          <p role="alert" className="text-[var(--sf-danger,#b91c1c)]">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
