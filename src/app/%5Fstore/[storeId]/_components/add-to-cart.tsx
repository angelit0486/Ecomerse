"use client";

import Link from "next/link";
import { useActionState } from "react";

import { addItem, type CartActionState } from "../carrito/actions";

/**
 * Agregar al carrito o comprar ahora: solo variante y cantidad; el precio lo pone
 * la base (§17.2).
 */
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
      {/* Enter en «Cantidad» envía con el primer botón de envío: que sea «agregar»,
          no «comprar ahora» (Gate F9). Oculto; funciona también sin JavaScript. */}
      <button type="submit" name="intent" value="add" hidden tabIndex={-1} />
      <label className="flex w-fit flex-col gap-1 text-sm font-medium">
        Cantidad
        <input
          type="number"
          name="quantity"
          min={1}
          max={999}
          defaultValue={1}
          inputMode="numeric"
          className="h-11 w-24 rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)] bg-[var(--sf-bg)] px-3"
        />
      </label>
      {available ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* «Comprar ahora» (F9-T03): agrega y lleva directo al pago. */}
          <button
            type="submit"
            name="intent"
            value="buy"
            disabled={!variantId || pending}
            aria-busy={pending || undefined}
            className="h-12 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-semibold text-[var(--sf-btn-fg)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Comprar ahora
          </button>
          <button
            type="submit"
            name="intent"
            value="add"
            disabled={!variantId || pending}
            className="h-12 rounded-[var(--sf-radius-btn)] border-2 border-[var(--sf-fg)] bg-[var(--sf-bg)] px-5 font-semibold text-[var(--sf-fg)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Agregando…" : "Agregar al carrito"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled
          className="h-12 w-full cursor-not-allowed rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] bg-[var(--sf-surface)] px-5 font-semibold text-[var(--sf-muted)]"
        >
          Agotado
        </button>
      )}
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
