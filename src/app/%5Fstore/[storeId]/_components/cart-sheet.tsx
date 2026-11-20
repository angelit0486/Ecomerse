"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { CutoffConfig } from "@/lib/theme/delivery-cutoff";

import { DeliveryCountdown } from "./delivery-countdown";
import { CART_ADDED_EVENT, type CartAdded } from "./quick-add";

/**
 * Carrito lateral (plan de experiencia, fase 1): al agregar desde la ficha o una
 * tarjeta se abre un panel con lo agregado, el envío gratis, la hora de corte y
 * «Pagar ahora», sin salir de la página. Solo con un look que lo pide; las demás
 * tiendas conservan el aviso flotante (`CartToast`).
 *
 * `<dialog>` modal nativo: el navegador atrapa el foco dentro, Esc lo cierra y al
 * cerrar el foco vuelve a donde estaba. Sin JavaScript no existe: «Agregar» sigue
 * siendo un formulario normal.
 */
export function CartSheet({
  shippingNote,
  cutoff,
  serverNow,
}: {
  /** «Envío gratis a todo México» o null si la tienda no lo ofrece. */
  shippingNote: string | null;
  cutoff?: CutoffConfig | undefined;
  serverNow?: number | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [item, setItem] = useState<CartAdded | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onAdded = (event: Event) => {
      setItem((event as CustomEvent<CartAdded>).detail);
      const el = dialog.current;
      if (el && !el.open) el.showModal();
    };
    window.addEventListener(CART_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(CART_ADDED_EVENT, onAdded);
  }, []);

  const close = () => dialog.current?.close();
  const count = item?.count;
  const pieces =
    count === undefined ? null : `${count} ${count === 1 ? "producto" : "productos"} en tu carrito`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="sf-cart-sheet m-0 ml-auto h-dvh max-h-none w-full max-w-md border-0 bg-[var(--sf-bg)] p-0 text-[var(--sf-fg)] backdrop:bg-black/60 max-sm:mt-auto max-sm:h-auto max-sm:max-w-none"
      // Un toque fuera del panel (en el fondo oscuro) también lo cierra.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="flex h-full flex-col gap-5 p-5 sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold">
            Agregado a tu carrito
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {item ? (
          <div className="sf-cart-sheet-item flex items-center gap-4">
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- copia chica servida por Storage
              <img
                src={item.image}
                alt=""
                width={88}
                height={88}
                className="sf-cart-sheet-img size-22 shrink-0 rounded-[var(--sf-radius-control)] bg-[var(--sf-surface)] object-contain"
              />
            ) : null}
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
                {item.title}
              </p>
              {item.price ? (
                <p className="sf-cart-sheet-price text-lg font-bold">{item.price}</p>
              ) : null}
              {pieces ? <p className="text-sm text-[var(--sf-muted)]">{pieces}</p> : null}
            </div>
          </div>
        ) : null}

        {shippingNote ? (
          <p className="sf-cart-sheet-ship flex items-center gap-2 text-sm font-semibold">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            {shippingNote}
          </p>
        ) : null}

        {cutoff ? (
          <DeliveryCountdown config={cutoff} variant="inline" serverNow={serverNow} />
        ) : null}

        <div className="mt-auto grid gap-3">
          <Link
            prefetch={false}
            href="/checkout"
            className="inline-flex h-14 items-center justify-center rounded-[var(--sf-radius-btn)] bg-[var(--sf-btn-bg)] px-5 text-base font-bold text-[var(--sf-btn-fg)]"
          >
            Pagar ahora
          </Link>
          <Link
            prefetch={false}
            href="/carrito"
            className="inline-flex h-12 items-center justify-center rounded-[var(--sf-radius-btn)] border border-[var(--sf-border-strong)] px-5 font-semibold"
          >
            Ver carrito
          </Link>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-11 items-center justify-center font-medium underline underline-offset-4"
          >
            Seguir comprando
          </button>
        </div>
      </div>
    </dialog>
  );
}
