"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { addItem, type CartActionState } from "../carrito/actions";

const MIN_QTY = 1;
const MAX_QTY = 999;

/**
 * Agregar al carrito o comprar ahora: solo variante y cantidad; el precio lo pone
 * la base (§17.2).
 */
export function AddToCart({
  storeId,
  variantId,
  available,
  title,
  price,
}: {
  storeId: string;
  variantId: string | null;
  available: boolean;
  /** Para la barra fija de móvil: nombre del producto y precio ya formateado. */
  title?: string;
  price?: string | null;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(
    addItem.bind(null, storeId),
    {},
  );
  const formId = useId();
  const [quantity, setQuantity] = useState(String(MIN_QTY));
  const buttons = useRef<HTMLDivElement>(null);
  const [buttonsOffscreen, setButtonsOffscreen] = useState(false);

  // Barra fija «Comprar ahora» (revisión de conversión, A3): aparece en móvil
  // mientras los botones principales no se ven, también en la vista inicial.
  useEffect(() => {
    const target = buttons.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setButtonsOffscreen(!entry?.isIntersecting),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [available]);

  const showBar = available && buttonsOffscreen && Boolean(variantId);
  // El pie no queda tapado por la barra: se reserva su alto mientras se ve.
  useEffect(() => {
    document.documentElement.classList.toggle("sf-buybar", showBar);
    return () => document.documentElement.classList.remove("sf-buybar");
  }, [showBar]);

  const current = Number.parseInt(quantity, 10);
  const step = (delta: number) => {
    const base = Number.isFinite(current) ? current : MIN_QTY;
    setQuantity(String(Math.min(MAX_QTY, Math.max(MIN_QTY, base + delta))));
  };

  return (
    <form id={formId} action={action} className="space-y-3">
      <input type="hidden" name="variant_id" value={variantId ?? ""} />
      {/* Enter en «Cantidad» envía con el primer botón de envío: que sea «agregar»,
          no «comprar ahora» (Gate F9). Oculto; funciona también sin JavaScript. */}
      <button type="submit" name="intent" value="add" hidden tabIndex={-1} />
      <div className="space-y-1">
        <label htmlFor={`${formId}-qty`} className="block text-sm font-medium">
          Cantidad
        </label>
        {/* Control −/+ de 44 px (revisión de conversión, B3); el campo sigue
            aceptando lo que se escriba y funciona sin JavaScript. */}
        <div className="inline-flex items-stretch rounded-[var(--sf-radius-control)] border border-[var(--sf-border-strong)]">
          <button
            type="button"
            aria-label="Restar 1"
            aria-controls={`${formId}-qty`}
            disabled={Number.isFinite(current) && current <= MIN_QTY}
            onClick={() => step(-1)}
            className="h-11 w-11 text-lg font-semibold disabled:opacity-40"
          >
            <span aria-hidden="true">−</span>
          </button>
          <input
            id={`${formId}-qty`}
            type="number"
            name="quantity"
            min={MIN_QTY}
            max={MAX_QTY}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            className="sf-qty h-11 w-14 border-x border-[var(--sf-border)] bg-[var(--sf-bg)] text-center"
          />
          <button
            type="button"
            aria-label="Sumar 1"
            aria-controls={`${formId}-qty`}
            disabled={Number.isFinite(current) && current >= MAX_QTY}
            onClick={() => step(1)}
            className="h-11 w-11 text-lg font-semibold disabled:opacity-40"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
      {available ? (
        <div ref={buttons} className="grid gap-3 sm:grid-cols-2">
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
      {/* Solo existe mientras se muestra: sin duplicar precio ni botón en la página. */}
      {showBar ? (
        <section
          aria-label="Compra rápida"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--sf-border)] bg-[var(--sf-bg)] px-4 py-3 shadow-[0_-4px_12px_rgb(0_0_0/0.08)] md:hidden"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              {title ? <p className="truncate text-sm">{title}</p> : null}
              {price ? <p className="font-bold">{price}</p> : null}
            </div>
            <button
              type="submit"
              form={formId}
              name="intent"
              value="buy"
              disabled={!variantId || pending}
              aria-busy={pending || undefined}
              className="h-12 shrink-0 rounded-[var(--sf-radius-btn)] border border-[var(--sf-btn-border)] bg-[var(--sf-btn-bg)] px-5 font-semibold text-[var(--sf-btn-fg)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Comprar ahora
            </button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
