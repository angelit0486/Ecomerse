"use client";

import { useEffect, useRef, useState } from "react";

import { JUST_PLACED_PARAM } from "@/lib/orders/just-placed";

const SECONDS = 3;

/**
 * Ficha del pedido por WhatsApp (interruptor `order_whatsapp_handoff`). El
 * botón siempre está. Justo después de confirmar (`autoOpen`), cuenta 3 s y abre
 * el chat de la tienda con la ficha escrita; «Quedarme aquí» lo detiene. Al
 * cargar se quita la marca de la dirección: volver o recargar no lo reabre.
 */
export function WhatsAppHandoff({ url, autoOpen }: { url: string; autoOpen: boolean }) {
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const here = new URL(window.location.href);
    if (here.searchParams.has(JUST_PLACED_PARAM)) {
      here.searchParams.delete(JUST_PLACED_PARAM);
      window.history.replaceState(window.history.state, "", here);
    }
    if (!autoOpen) return;
    let n = SECONDS;
    // Primer valor fuera del cuerpo del efecto (regla react-hooks) y luego cada segundo.
    const first = window.setTimeout(() => setLeft(n), 0);
    timer.current = window.setInterval(() => {
      n -= 1;
      if (n > 0) {
        setLeft(n);
        return;
      }
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
      setLeft(null);
      window.location.assign(url);
    }, 1000);
    return () => {
      window.clearTimeout(first);
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
    };
  }, [autoOpen, url]);

  const stay = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
  };

  return (
    <section
      aria-labelledby="ficha-whatsapp"
      className="space-y-3 rounded-[var(--sf-radius-card)] border border-[var(--sf-border)] p-5"
    >
      <h2 id="ficha-whatsapp" className="font-semibold">
        Envía tu pedido por WhatsApp
      </h2>
      <p className="text-sm">
        La tienda confirma tu pedido por WhatsApp. Te abrimos el chat con la ficha de tu pedido ya
        escrita: productos, total, dirección y contacto. Solo toca Enviar.
      </p>
      {/* Región viva siempre presente: el lector la anuncia una vez, no cada segundo. */}
      <p role="status" className="sr-only">
        {left !== null ? "Abriendo WhatsApp en unos segundos." : ""}
      </p>
      {left !== null ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-handoff="counting">
          <span aria-hidden="true">
            Abriendo WhatsApp en <span className="font-semibold tabular-nums">{left}</span>…
          </span>
          <button
            type="button"
            onClick={stay}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
          >
            Quedarme aquí
          </button>
        </p>
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center justify-center rounded-[var(--sf-radius-btn)] bg-[var(--sf-primary)] px-4 text-sm font-medium text-[var(--sf-on-primary)]"
      >
        Enviar pedido por WhatsApp
      </a>
    </section>
  );
}
