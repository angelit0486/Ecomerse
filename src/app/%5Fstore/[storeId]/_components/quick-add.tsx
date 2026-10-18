"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { addItem, type CartActionState } from "../carrito/actions";

/** Evento con el que «Agregar» avisa al aviso flotante del carrito. */
export const CART_ADDED_EVENT = "sf:cart-added";

interface CartAdded {
  title: string;
  count: number | undefined;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/**
 * «Agregar» de la tarjeta (rediseño A+B): manda solo la variante y una pieza; el
 * precio y las existencias los decide la base (§17.2). Sin JavaScript es un
 * formulario normal.
 */
export function QuickAdd({
  storeId,
  variantId,
  title,
}: {
  storeId: string;
  variantId: string;
  title: string;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    addItem.bind(null, storeId),
    {},
  );
  // «Agregado» dura 2 s por cada respuesta correcta; el aviso flotante la anuncia.
  const [seen, setSeen] = useState<CartActionState | null>(null);
  useEffect(() => {
    if (!state.ok) return;
    window.dispatchEvent(
      new CustomEvent<CartAdded>(CART_ADDED_EVENT, { detail: { title, count: state.count } }),
    );
    const timer = setTimeout(() => setSeen(state), 2000);
    return () => clearTimeout(timer);
  }, [state, title]);
  const done = Boolean(state.ok) && seen !== state;

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-3 text-sm font-semibold text-[var(--sf-btn-fg)] disabled:opacity-70"
      >
        <svg {...ICON} className="h-4 w-4 shrink-0">
          {done ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
        </svg>
        {pending ? "Agregando…" : done ? "Agregado" : "Agregar"}
        <span className="sr-only"> {title} al carrito</span>
      </button>
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--sf-danger,#b91c1c)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Aviso flotante tras «Agregar» desde una tarjeta: qué se agregó y el enlace al
 * carrito. La región `aria-live` existe siempre para que el lector de pantalla
 * anuncie el cambio; se va sola a los 5 s.
 */
export function CartToast() {
  const [item, setItem] = useState<CartAdded | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAdded = (event: Event) => {
      setItem((event as CustomEvent<CartAdded>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setItem(null), 5000);
    };
    window.addEventListener(CART_ADDED_EVENT, onAdded);
    return () => {
      window.removeEventListener(CART_ADDED_EVENT, onAdded);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:justify-end"
    >
      {item ? (
        <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-[var(--sf-radius-card)] bg-[var(--sf-fg)] px-4 py-3 text-sm text-[var(--sf-bg)] shadow-lg [&_:focus-visible]:outline-[var(--sf-bg)]">
          <svg {...ICON} className="h-5 w-5 shrink-0">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
          <p className="min-w-0 flex-1">
            <span className="line-clamp-1 font-semibold">{item.title}</span>
            Se agregó a tu carrito.
          </p>
          <Link href="/carrito" className="shrink-0 font-semibold underline underline-offset-2">
            Ver carrito{item.count ? ` (${item.count})` : ""}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
